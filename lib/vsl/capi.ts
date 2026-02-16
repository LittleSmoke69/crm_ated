/**
 * Meta Conversions API (CAPI) - server-side. Nunca expor token ao client.
 */

export interface CapiUserData {
  fbp?: string | null;
  fbc?: string | null;
  client_ip_address?: string | null;
  client_user_agent?: string | null;
}

export interface CapiEventPayload {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  user_data: CapiUserData;
  custom_data?: Record<string, unknown>;
}

export async function sendCapiEvent(
  pixelId: string,
  accessToken: string,
  baseUrl: string,
  payload: CapiEventPayload
): Promise<{ success: boolean; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [payload] }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { success: false, error: `CAPI ${res.status}: ${text}` };
    }
    const data = JSON.parse(text || '{}');
    if (data.error) {
      return { success: false, error: data.error.message || JSON.stringify(data.error) };
    }
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { success: false, error: err };
  }
}
