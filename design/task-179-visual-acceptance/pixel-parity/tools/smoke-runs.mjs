const base = "http://127.0.0.1:5302/api/v1";
const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "pixel-admin@example.com",
    password: "pixel-demo-password",
  }),
});
const auth = await login.json();
const headers = { authorization: `Bearer ${auth.accessToken}` };
const runs = await (
  await fetch(`${base}/boards/px-board-agent-ops/runs?limit=20`, { headers })
).json();
console.log(
  "runs",
  runs.map((run) => [run.id, run.status, run.commandCount]),
);
for (const run of runs.slice(0, 5)) {
  const preview = await fetch(
    `${base}/boards/px-board-agent-ops/runs/${run.id}/revert/preview`,
    { method: "POST", headers },
  );
  console.log(run.id, run.status, preview.status, await preview.text());
}
