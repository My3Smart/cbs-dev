import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listRows = createServerFn({ method: "POST" })
  .inputValidator((input: { table: string; select: string; orderBy: string; ascending: boolean; limit: number }) =>
    z
      .object({
        table: z.string().max(40),
        select: z.string().max(1000),
        orderBy: z.string().max(60),
        ascending: z.boolean(),
        limit: z.number().int(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireStaff, listTable } = await import("./mysql.server");
    await requireStaff();
    return (await listTable(data)) as any[];
  });

export const countRows = createServerFn({ method: "POST" })
  .inputValidator((input: { table: string }) => z.object({ table: z.string().max(40) }).parse(input))
  .handler(async ({ data }) => {
    const { requireStaff, one, READABLE_TABLES } = await import("./mysql.server");
    await requireStaff();
    if (!(READABLE_TABLES as readonly string[]).includes(data.table)) throw new Error("Unknown table.");
    const row = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${data.table}\``);
    return Number(row?.n ?? 0);
  });
