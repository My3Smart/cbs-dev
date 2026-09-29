import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getCurrentStaff = createServerFn({ method: "GET" }).handler(async () => {
  const { currentStaff } = await import("./mysql.server");
  return currentStaff();
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string; password: string }) =>
    z.object({ username: z.string().trim().min(1).max(255), password: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { one, signSession, SESSION_COOKIE, audit } = await import("./mysql.server");
    const { setCookie } = await import("@tanstack/react-start/server");
    const bcrypt = (await import("bcryptjs")).default;
    const email = data.username.includes("@") ? data.username.toLowerCase() : `${data.username.toLowerCase()}@cbs.local`;
    const user = await one<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM staff_users WHERE email = ?",
      [email],
    );
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
      throw new Error("Wrong username or password.");
    }
    setCookie(SESSION_COOKIE, signSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await audit(user.id, "STAFF_SIGN_IN", "staff_users", user.id, {});
    return { ok: true };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { SESSION_COOKIE } = await import("./mysql.server");
  const { deleteCookie } = await import("@tanstack/react-start/server");
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true };
});
