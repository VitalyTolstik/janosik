# Connection and board operations

Read only the sections relevant to the user's request. Tool schemas determine
exact parameters and limits; do not infer missing tools from this guide.

## Connect and manage API keys

The operator creates a key in the app under **Account → API keys**, using a
browser user session. Copy it when shown: the full key is displayed once.
Choose the board scope, scope preset (`observer`, `worker`, `reviewer` or
`admin`), read-only setting, trusted-CI flag, expiry and rate limit for the
agent. The preset is immutable and never raises the user's board role. API-key
list/create/revoke endpoints reject API-key authentication; MCP has no tools
for minting or rotating credentials.

Configure the MCP host environment:

- `JANOSIK_URL`: clean HTTP(S) origin, such as `https://boards.example.com`.
  Do not include `/api`, `/app`, credentials, query or fragment.
- `JANOSIK_TOKEN`: the `jnk_...` key. Prefer environment configuration over a
  command-line token flag. Keep the real value out of cards, comments and reports.
- `JANOSIK_APP_BASE`: UI path used to build links, such as `/app` for the
  self-host image. It is separate from the API origin.

The MCP process reads configuration at startup and sends the key as Bearer
credentials on API requests. For rotation, create a replacement in the app,
update the host environment, restart MCP, verify access, then revoke the old key.
Never request a token in a board comment or copy it into task content.

`JANOSIK_MCP_TOOLSETS` selects groups; `default,members` extends the default,
`all` enables every group. The removed `invitations` name is accepted as a
no-op with a warning. `JANOSIK_MCP_READONLY=1` exposes only read tools.
Enabled tools do not expand the user's requested scope or the key's preset.

When an API-key operation emits activity, it is attributed as `actorType: "agent"`.
Reads do not create activity entries. Separate accounts make users and claims
independently attributable; a separate key alone does not give a separate claim
identity. A board-scoped key cannot create or import other boards.

If connection fails: 401 calls for checking the configured credential/expiry;
403 can indicate board role, key preset/read-only restrictions, a board-scoped
key aimed at another board, or a session-only route. Destructive tools answer
409 `approval_required` without a trusted-CI key. The approval request API ships
in 166.5; until then nothing is queued and a human performs the action in the
browser. A missing tool can indicate a disabled group or MCP read-only mode.
Report the specific limitation rather than repeatedly retrying an unchanged
request.

## Structure, cards and labels

- Create/rename boards with their focused tools. Archive old boards for cleanup.
  Create/import are separate REST operations; inspect state before repeating
  them after an ambiguous failure.
- Create, rename, move, duplicate or sort columns as requested. Column order
  affects first-column work discovery and the last-column MCP Done check.
  `janosik_set_column_wip_limit` changes a column setting; do not infer from the
  limit that a task is complete or that a move was rejected. Read the result.
- `janosik_move_card` covers moving between columns and ordering within a column.
  Use actual destination ids and its position parameter. Read the card and task
  contract before moving it into the last column.
- Duplicate only when a separate card or column is wanted. Duplication is not a
  substitute for moving or unarchiving, and repeated duplicate calls create copies.
- Manage existing labels with create/rename/color tools; use
  `janosik_set_card_label` for card membership. Deleting a board label affects
  cards using it. Do not treat label deletion as removing it from one card.
- Use focused card tools for priority, assignee, due date and cover, and checklist
  tools for steps. Read each schema for clearing values and supported palettes.

## Import and export

`janosik_export_board` returns the app's JSON export envelope; `outputPath`
requires filesystem access and is refused in MCP read-only mode. Export without
that option can return data in read-only mode. For responses over the size
budget, use a narrower board read or a file export when enabled; do not pretend
a truncated response is a complete backup.

`janosik_import_board` uses the app's import format to create a board. It is not
an update/merge operation for an existing board. Check its result and the created
board before claiming that every type of history was transferred.

## Attachments and local files

Listing attachments is separate from reading their bytes. Upload/download and
file export access the filesystem of the **MCP server machine**, which may differ
from the user's desktop or coding workspace.

File access is disabled by default. The operator enables
`JANOSIK_MCP_ALLOW_FS=1` and can confine access with
`JANOSIK_MCP_FS_ROOT=/path/to/sandbox`; setting the root alone does not enable it.
Relative paths resolve against that root when configured. Symlink escapes and
existing output files are refused. Choose a new destination instead of deleting
an existing file to get past this refusal. Respect attachment size/type limits;
if MIME inference fails, inspect the file and schema rather than inventing a type.

For screenshot/test evidence, upload an appropriate permitted file and post an
`evidence` comment explaining what it demonstrates. Do not claim an attachment
alone satisfies the typed evidence-comment check. Delete attachments only when
removal is intended; no attachment archive tool exists.

## Members, agent sessions and public shares

These are opt-in groups, except agent sessions (default). Use them when the
user asks for the corresponding operation, rather than as automatic
task-setup steps.

- `members`: list members, invite, change roles or remove access. Read current
  membership and intended role before changing it; backend admin rules apply.
  Inviting, updating or removing a member is destructive and needs approval
  unless the key is trusted CI; a board `destructive: "deny"` policy blocks it.
- `sessions`: start a board-scoped agent session, heartbeat it and end it. A
  session adds attribution and pause context; it grants no rights beyond the
  token. Start/heartbeat are PAT-only.
- `account`: `janosik_whoami` identifies the token owner and its scope. Profile
  writes, invitations, avatar upload, password, email and API keys are not
  exposed; those routes are session-only.
- `shares`: an ADMIN can list/create/update/refresh/revoke **public read-only**
  links. A `live` link follows the board; a `snapshot` is frozen and can survive
  deletion of its source board. Refresh recaptures a snapshot; it is not valid
  for live links. Check comment/attachment visibility and expiry against the
  sharing request. Return the URL supplied by MCP; do not guess its UI prefix.
  Creating, updating or revoking a share is destructive: it needs approval
  unless the key is trusted CI and the board policy allows it.
  Revoking public access requires revoking the share, not simply archiving the
  source board.

MCP does not expose browser-local backup scheduling, undo/redo, realtime
presence, invitations, profile writes, avatar upload, account security,
API-key management or the master admin panel. Explain these app-only boundaries
when a request reaches them.
