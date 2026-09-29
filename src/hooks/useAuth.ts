import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentStaff } from "@/lib/auth.functions";

export function useAuth() {
  const me = useServerFn(getCurrentStaff);
  const query = useQuery({ queryKey: ["me"], queryFn: () => me(), retry: false, staleTime: 60_000 });
  const user = query.data ?? null;
  return { session: user, user, loading: query.isLoading, roles: user?.roles ?? [] };
}

/** Roles of the signed-in staff member (userId kept for call-site compatibility). */
export function useRoles(_userId?: string) {
  const { user, loading } = useAuth();
  return { data: loading ? undefined : (user?.roles ?? []) };
}
