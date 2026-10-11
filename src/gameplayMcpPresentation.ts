import { StudyError } from './errors.js';

/** Leave room for the JSON-RPC envelope below the SDK's default 10 MiB limit. */
export const GAMEPLAY_MCP_PRESENTATION_LIMIT = 9 * 1024 ** 2;
const ENVELOPE_RESERVE = 1024;
type Observation = {
  session_path?: string;
  screenshot_image_base64?: string;
  screenshot_png_base64?: string;
  screenshot_mime_type?: string;
  screenshots?: { url: string }[];
};
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** MCP has one image block; CLI and retained observations keep their original bytes. */
export function presentGameplayObservation<T extends object>(output: T): { content: Content[]; structuredContent: T } {
  const source = output as Observation & { observation?: Observation };
  const observation = source.observation ?? source;
  const data = observation.screenshot_image_base64 || observation.screenshot_png_base64;
  const summary = structuredClone(output);
  const copy = summary as Observation & { observation?: Observation };
  const projected = copy.observation ?? copy;
  if ('screenshot_image_base64' in projected) projected.screenshot_image_base64 = '';
  if ('screenshot_png_base64' in projected) projected.screenshot_png_base64 = '';
  for (const frame of projected.screenshots ?? []) if (frame.url.startsWith('data:image/')) frame.url = '';
  const result: { content: Content[]; structuredContent: T } = {
    content: [{ type: 'text', text: JSON.stringify(summary) }], structuredContent: summary,
  };
  if (data) result.content.push({ type: 'image', data, mimeType: observation.screenshot_mime_type ?? 'image/png' });
  const bytes = () => Buffer.byteLength(JSON.stringify(result), 'utf8') + ENVELOPE_RESERVE;
  if (bytes() >= GAMEPLAY_MCP_PRESENTATION_LIMIT) {
    result.content = result.content.filter(block => block.type !== 'image');
    result.content.push({ type: 'text', text: `Actual frame omitted from this MCP response because it exceeds the response size limit. The full frame remains in retained session evidence${observation.session_path ? ` for ${observation.session_path}` : ''}.` });
  }
  if (bytes() >= GAMEPLAY_MCP_PRESENTATION_LIMIT) throw new StudyError('gameplay_mcp_limit', 'Gameplay metadata exceeds the MCP response limit; the full observation remains in retained session evidence');
  return result;
}
