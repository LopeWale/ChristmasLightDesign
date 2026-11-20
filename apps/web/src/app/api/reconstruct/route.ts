import { NextResponse } from 'next/server';
import { ReconstructionJobSchema, type ReconstructionJob } from '@lumen3d/shared-schemas';

function getWorkerBaseUrl(): string {
  return (process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

function rewriteJobUrls(job: ReconstructionJob): ReconstructionJob {
  const id = encodeURIComponent(job.jobId);
  return {
    ...job,
    glbUrl: job.glbUrl ? `/api/reconstruct?jobId=${id}&artifact=scene.glb` : undefined,
    camerasUrl: job.camerasUrl
      ? `/api/reconstruct?jobId=${id}&artifact=cameras.json`
      : undefined,
    referenceImageUrl: job.referenceImageUrl
      ? `/api/reconstruct?jobId=${id}&artifact=reference_front.png`
      : undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  const workerBase = getWorkerBaseUrl();
  const contentType = request.headers.get('content-type') || '';

  try {
    let upstreamResp: Response;
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      upstreamResp = await fetch(`${workerBase}/jobs/reconstruct`, {
        method: 'POST',
        body: formData,
      });
    } else {
      const body = await request.json().catch(() => ({ demo: true }));
      const endpoint = body?.demo === false ? '/jobs/reconstruct' : '/jobs/demo';
      upstreamResp = await fetch(`${workerBase}${endpoint}`, {
        method: 'POST',
      });
    }

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      return NextResponse.json(
        { error: `Reconstruction worker error (${upstreamResp.status}): ${errText}` },
        { status: upstreamResp.status }
      );
    }

    const rawJob = await upstreamResp.json();
    const parsed = ReconstructionJobSchema.parse(rawJob);
    return NextResponse.json(rewriteJobUrls(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach recon-worker';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const workerBase = getWorkerBaseUrl();
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const artifact = searchParams.get('artifact');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing required query param: jobId' }, { status: 400 });
  }

  try {
    if (artifact) {
      const safeArtifact = artifact.replace(/[^a-zA-Z0-9._-]/g, '');
      const artifactResp = await fetch(
        `${workerBase}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(safeArtifact)}`,
        { cache: 'no-store' }
      );
      if (!artifactResp.ok) {
        return NextResponse.json(
          { error: `Artifact '${safeArtifact}' not found` },
          { status: artifactResp.status }
        );
      }
      const contentType =
        artifactResp.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await artifactResp.arrayBuffer();
      return new Response(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    }

    const statusResp = await fetch(
      `${workerBase}/jobs/${encodeURIComponent(jobId)}`,
      { cache: 'no-store' }
    );
    if (!statusResp.ok) {
      const errText = await statusResp.text();
      return NextResponse.json(
        { error: `Worker job lookup failed: ${errText}` },
        { status: statusResp.status }
      );
    }

    const rawJob = await statusResp.json();
    const parsed = ReconstructionJobSchema.parse(rawJob);
    return NextResponse.json(rewriteJobUrls(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to poll recon-worker';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
