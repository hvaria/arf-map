import { QueryClient, QueryFunction } from "@tanstack/react-query";

// In native Capacitor builds, set VITE_API_URL to your deployed server, e.g.:
//   VITE_API_URL=https://your-server.com npm run mobile:build
const API_BASE =
  import.meta.env.VITE_API_URL ||
  ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        let message = text; try { message = JSON.parse(text).message || text; } catch {} throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // S-01: include the CSRF sentinel header on all state-changing requests.
  // The server middleware in index.ts rejects POST/PUT/DELETE/PATCH that
  // lack this header, preventing cross-site form-submission attacks.
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${url}`, {
    method,
    credentials: "include",
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Default to "returnNull" on 401 — matches what every protected portal
// query has been opting in to (39 sites). Pages that need the throw
// behavior can still override per-query with getQueryFn({ on401: "throw" }).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
