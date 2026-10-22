import { startInstance, call } from "./common.mjs";
const A = await startInstance(5181, "a");
const B = await startInstance(5182, "b");
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
await call(A.base, "GET", "/api/config");
// Warm both instances' shared copies of Users
const first = (await call(A.base, "POST", "/api/auth/login", { json: { email: "newvolunteer@example.com", password: "password123" } })).body.token;
await call(B.base, "GET", "/api/auth/me", { token: first });
// Change password on A -> new token (tokenVersion + 1)
const changed = await call(A.base, "POST", "/api/auth/change-password", { token: first, json: { currentPassword: "password123", newPassword: "Totally-new-pass-55" } });
ok(changed.status === 200, `password changed on A (${changed.status})`);
const me = await call(B.base, "GET", "/api/auth/me", { token: changed.body.token });
ok(me.status === 200 && me.body.user.mustChangePassword === false, `new token works at once on B, whose cache was stale (${me.status})`);
const old = await call(B.base, "GET", "/api/auth/me", { token: first });
ok(old.status === 401, `the old token is refused on B (${old.status})`);
// Pick a coordinator on B right away (B must not use stale mustChangePassword)
const coords = await call(B.base, "GET", "/api/domains/D001/coordinators", { token: changed.body.token });
ok(coords.status === 200, `B serves the next first-login step (${coords.status})`);
const pick = await call(B.base, "POST", "/api/auth/coordinator", { token: changed.body.token, json: { coordinatorId: coords.body.coordinators[0].id } });
ok(pick.status === 200, `choosing a coordinator on B works (${pick.status})`);
const meA = await call(A.base, "GET", "/api/auth/me", { token: changed.body.token });
ok(meA.status === 200 && meA.body.user.coordinatorId, `A sees the coordinator choice (${meA.status}, ${meA.body.user?.coordinatorId})`);
A.server.close(); B.server.close(); process.exit();
