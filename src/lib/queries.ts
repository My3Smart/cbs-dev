import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { countRows, listRows } from "@/lib/data.functions";

/** Generic dense-list read from the MySQL database (staff session required). */
export function useTable<T = Record<string, unknown>>(
  table: string,
  options?: { select?: string; orderBy?: string; ascending?: boolean; limit?: number },
) {
  const select = options?.select ?? "*";
  const orderBy = options?.orderBy ?? "created_at";
  const ascending = options?.ascending ?? false;
  const limit = options?.limit ?? 200;
  const list = useServerFn(listRows);

  return useQuery({
    queryKey: ["table", table, select, orderBy, ascending, limit],
    queryFn: async () => (await list({ data: { table, select, orderBy, ascending, limit } })) as T[],
  });
}

export function useCount(table: string) {
  const count = useServerFn(countRows);
  return useQuery({
    queryKey: ["count", table],
    queryFn: () => count({ data: { table } }),
  });
}
