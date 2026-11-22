import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  extractArtifactBasename,
  generateScanQrDataUrl,
  resolveMobileScanOrigin,
  rewriteJobArtifactUrls,
  rewriteScanSessionUrls,
} from '../src/lib/scan/scanProxy';
import { POST as createScanSession } from '../src/app/api/scan/sessions/route';
import { GET as getScanSession } from '../src/app/api/scan/sessions/[sessionId]/route';
import { POST as postScanFrame } from '../src/app/api/scan/sessions/[sessionId]/frames/route';

describe('Live Scan Proxy, LAN QR Generator & Versioned Artifact Rewriting', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.RECON_WORKER_URL = 'http://127.0.0.1:8001';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('preserves versioned scene_r002.glb and scene_r002.splat filenames when rewriting worker URLs', () => {
    expect(extractArtifactBasename('/jobs/scan-abc/artifacts/scene_r002.glb', 'scene.glb')).toBe(
      'scene_r002.glb'
    );
    const rewritten = rewriteJobArtifactUrls({
      jobId: 'scan-12345',
      status: 'completed',
      progress: 52,
      mode: 'da3',
      backendUsed: 'da3',
      glbUrl: '/jobs/scan-12345/artifacts/scene_r002.glb',
      splatUrl: '/jobs/scan-12345/artifacts/scene_r002.splat',
      camerasUrl: '/jobs/scan-12345/artifacts/cameras.json',
      referenceImageUrl: '/jobs/scan-12345/artifacts/reference_front.png',
    });

    expect(rewritten.glbUrl).toBe(
      '/api/reconstruct?jobId=scan-12345&artifact=scene_r002.glb'
    );
    expect(rewritten.splatUrl).toBe(
      '/api/reconstruct?jobId=scan-12345&artifact=scene_r002.splat'
    );
  });

  it('resolves localhost origin to Wi-Fi LAN IPv4 for phone QR codes and generates a PNG QR data URL', async () => {
    const req = new Request('https://localhost:3000/api/scan/sessions', {
      method: 'POST',
    });
    const origin = resolveMobileScanOrigin(req, {
      en0: [
        {
          address: '192.168.1.48',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.1.48/24',
        },
      ],
    });
    expect(origin).toBe('https://192.168.1.48:3000');

    const qr = await generateScanQrDataUrl(`${origin}/scan/scan-12345`);
    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(qr.length).toBeGreaterThan(200);
  });

  it('handles Next.js 16 async route params for session creation, polling, and frame upload', async () => {
    const mockWorkerSession = {
      sessionId: 'scan-999aa',
      status: 'ready' as const,
      address: '1007 N Shartel Ave',
      targetHeightMeters: 9.6,
      coveredSectors: ['front', 'right_side'],
      frames: [
        {
          frameId: 'f-001',
          sector: 'front',
          sharpnessScore: 142.4,
          yawDegrees: 180,
          capturedAtIso: '2026-11-22T18:00:00Z',
        },
      ],
      latestJob: {
        jobId: 'scan-999aa',
        status: 'completed',
        progress: 52,
        mode: 'da3',
        backendUsed: 'da3',
        glbUrl: '/jobs/scan-999aa/artifacts/scene_r002.glb',
        splatUrl: '/jobs/scan-999aa/artifacts/scene_r002.splat',
        camerasUrl: '/jobs/scan-999aa/artifacts/cameras.json',
        referenceImageUrl: '/jobs/scan-999aa/artifacts/reference_front.png',
      },
      neuralBackendUsed: 'da3_moge2_mps',
      guidanceMessage: 'Captured 2/5 angles — walk toward 45° Front-Right Corner next.',
      updatedAtIso: '2026-11-22T18:00:02Z',
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/scan/sessions') || url.includes('/scan/sessions/scan-999aa')) {
        return new Response(JSON.stringify(mockWorkerSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const createReq = new Request('http://localhost:3000/api/scan/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '1007 N Shartel Ave', targetHeightMeters: 9.6 }),
    });
    const createResp = await createScanSession(createReq);
    expect(createResp.status).toBe(200);
    expect(createResp.headers.get('cache-control')).toContain('no-store');
    const createdBody = await createResp.json();
    expect(createdBody.sessionId).toBe('scan-999aa');
    expect(createdBody.mobileScanUrl).toContain('/scan/scan-999aa');
    expect(createdBody.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(createdBody.latestJob.glbUrl).toContain('artifact=scene_r002.glb');

    const getResp = await getScanSession(
      new Request('http://localhost:3000/api/scan/sessions/scan-999aa'),
      { params: Promise.resolve({ sessionId: 'scan-999aa' }) }
    );
    expect(getResp.status).toBe(200);
    const polledBody = await getResp.json();
    expect(polledBody.latestJob.splatUrl).toContain('artifact=scene_r002.splat');

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      'frame.jpg'
    );
    formData.append('sector', 'right_side');
    formData.append('yawDeg', '262');

    const frameResp = await postScanFrame(
      new Request('http://localhost:3000/api/scan/sessions/scan-999aa/frames', {
        method: 'POST',
        body: formData,
      }),
      { params: Promise.resolve({ sessionId: 'scan-999aa' }) }
    );
    expect(frameResp.status).toBe(200);
    const frameBody = await frameResp.json();
    expect(rewriteScanSessionUrls(mockWorkerSession).latestJob?.glbUrl).toBe(
      frameBody.latestJob.glbUrl
    );
  });
});
