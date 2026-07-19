/**
 * Chrome's automatic DevTools workspace discovery cannot translate the
 * container path (`/app`) to the Windows host filesystem. Returning 404 keeps
 * normal source maps and HMR enabled without asking Chrome to mount an invalid
 * local workspace.
 */
export function GET() {
  return new Response(null, {
    status: 404,
    headers: {
      "cache-control": "no-store",
    },
  });
}
