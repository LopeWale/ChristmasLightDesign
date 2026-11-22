import os from 'node:os';
import QRCode from 'qrcode';
import type { LiveScanSession, ReconstructionJob } from '@lumen3d/shared-schemas';

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };

export function getWorkerBaseUrl(): string {
  return (process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001').replace(
    /\/+$/,
    ''
  );
}

export function extractArtifactBasename(
  urlOrPath: string | undefined,
  fallback: string
): string {
  if (!urlOrPath) return fallback;
  try {
    if (urlOrPath.includes('artifact=')) {
      const parsed = new URL(urlOrPath, 'http://localhost');
      const fromQuery = parsed.searchParams.get('artifact');
      if (fromQuery) {
        return fromQuery.replace(/[^a-zA-Z0-9._-]/g, '') || fallback;
      }
    }
  } catch {
    // Fall through to path segment extraction
  }
  const clean = urlOrPath.split('?')[0]?.split('#')[0] ?? '';
  const seg = clean.split('/').filter(Boolean).pop() ?? '';
  const sanitized = seg.replace(/[^a-zA-Z0-9._-]/g, '');
  return sanitized || fallback;
}

export function rewriteJobArtifactUrls(
  job: ReconstructionJob
): ReconstructionJob {
  const id = encodeURIComponent(job.jobId);
  const glbName = extractArtifactBasename(job.glbUrl, 'scene.glb');
  const splatName = extractArtifactBasename(job.splatUrl, 'scene.splat');
  const camName = extractArtifactBasename(job.camerasUrl, 'cameras.json');
  const refName = extractArtifactBasename(
    job.referenceImageUrl,
    'reference_front.png'
  );

  return {
    ...job,
    glbUrl: job.glbUrl
      ? `/api/reconstruct?jobId=${id}&artifact=${encodeURIComponent(glbName)}`
      : undefined,
    splatUrl: job.splatUrl
      ? `/api/reconstruct?jobId=${id}&artifact=${encodeURIComponent(splatName)}`
      : undefined,
    camerasUrl: job.camerasUrl
      ? `/api/reconstruct?jobId=${id}&artifact=${encodeURIComponent(camName)}`
      : undefined,
    referenceImageUrl: job.referenceImageUrl
      ? `/api/reconstruct?jobId=${id}&artifact=${encodeURIComponent(refName)}`
      : undefined,
  };
}

export function rewriteScanSessionUrls(
  session: LiveScanSession
): LiveScanSession {
  if (!session.latestJob) return session;
  return {
    ...session,
    latestJob: rewriteJobArtifactUrls(session.latestJob),
  };
}

export function detectPrimaryLanIpv4(
  interfacesOverride?: NodeJS.Dict<os.NetworkInterfaceInfo[]>
): string | null {
  const nets = interfacesOverride ?? os.networkInterfaces();
  const preferredPrefixes = ['en', 'eth', 'wlan', 'wi-fi'];
  const entries = Object.entries(nets);

  entries.sort(([a], [b]) => {
    const aPref = preferredPrefixes.some((p) => a.toLowerCase().startsWith(p))
      ? 0
      : 1;
    const bPref = preferredPrefixes.some((p) => b.toLowerCase().startsWith(p))
      ? 0
      : 1;
    return aPref - bPref;
  });

  for (const [, list] of entries) {
    if (!list) continue;
    for (const info of list) {
      const isV4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (isV4 && !info.internal && !info.address.startsWith('169.254.')) {
        return info.address;
      }
    }
  }
  return null;
}

export function resolveMobileScanOrigin(
  request: Request,
  interfacesOverride?: NodeJS.Dict<os.NetworkInterfaceInfo[]>
): string {
  const publicEnvOrigin = process.env.LUMEN3D_PUBLIC_ORIGIN?.trim();
  if (publicEnvOrigin) {
    return publicEnvOrigin.replace(/\/+$/, '');
  }

  const reqUrl = new URL(request.url);
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = fwdHost || request.headers.get('host') || reqUrl.host;
  const protocol = fwdProto ? `${fwdProto.replace(/:$/, '')}:` : reqUrl.protocol;

  const [hostname, explicitPort] = hostHeader.split(':');
  const port = explicitPort || reqUrl.port;

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  ) {
    const lanIp = detectPrimaryLanIpv4(interfacesOverride);
    if (lanIp) {
      return `${protocol}//${lanIp}${port ? `:${port}` : ''}`;
    }
  }

  return `${protocol}//${hostHeader}`;
}

export async function generateScanQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: {
      dark: '#0c1017',
      light: '#ffffff',
    },
  });
}

export interface LiveScanSessionWithQr extends LiveScanSession {
  mobileScanUrl: string;
  qrCodeDataUrl: string;
}
