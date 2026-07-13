import {
  caregiverEldersPageSchema,
  familyEldersPageSchema,
  type CaregiverElderSummary,
  type FamilyElderSummary
} from '@eldercare/contracts';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);

export class PortalEldersRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Unable to load scoped elder records');
    this.name = 'PortalEldersRequestError';
    this.status = status;
  }
}

async function loadScopedPage(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new PortalEldersRequestError(0);
  }

  if (!response.ok) {
    throw new PortalEldersRequestError(response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new PortalEldersRequestError(502);
  }
}

export async function loadFamilyElders(signal?: AbortSignal): Promise<FamilyElderSummary[]> {
  const parsed = familyEldersPageSchema.safeParse(await loadScopedPage('/family/elders', signal));
  if (!parsed.success) {
    throw new PortalEldersRequestError(502);
  }
  return parsed.data.items;
}

export async function loadCaregiverElders(
  signal?: AbortSignal
): Promise<CaregiverElderSummary[]> {
  const parsed = caregiverEldersPageSchema.safeParse(
    await loadScopedPage('/caregiver/elders', signal)
  );
  if (!parsed.success) {
    throw new PortalEldersRequestError(502);
  }
  return parsed.data.items;
}
