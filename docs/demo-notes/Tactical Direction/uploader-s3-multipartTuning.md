---
status: pending
created: 2026-10-05T11:02:41
updated: 2026-10-05T11:14:19
tags: [tactical-direction, uploader/multipart]
aliases: ["Hold S3 uploader part size, concurrency and timeout until uplink headroom is measured"]
implementation:
cssclasses: [agent-note]
---

# Hold S3 uploader part size, concurrency and timeout until uplink headroom is measured

> [!question|banner] Pending since 2026-10-05 11:14:19
> Do not change `part_size_mb`, `concurrency` or `timeout_s` in the `uploader` config until the user has measured the gateway uplink headroom.
> The values are undecided; the user picks them once the measurements exist.

## 1. Context

- Project: `ingest-gateway`.
- Problem reported by the user: the S3 uploader times out on big files.
- Current `uploader` config (as pasted by the user): `bucket: ingest-raw-prod`, `part_size_mb: 5`, `timeout_s: 30`, no `concurrency` key, and static AWS keys in the file.
- Operating constraint stated by the user: the gateway boxes share a 1 Gbps uplink with the API traffic.
- User observation (not measured by the agent): latency spikes appear when uploads saturate that uplink.
- Not yet established: the root cause of the timeouts and the available uplink headroom.
- The credentials part of the same exchange is agreed separately in [[uploader-s3-credentials]].

## 2. Agent Proposal

> [!abstract] Proposed
> Switch large uploads to multipart with bigger parts and parallelism, and raise the per-request timeout:
> - `part_size_mb: 64` (from 5)
> - `concurrency: 8` (new)
> - `timeout_s: 120` (from 30)

## 3. User Disagreement

> [!warning] User direction
> - No 8 concurrent parts: saturating the shared 1 Gbps uplink causes latency spikes for API traffic.
> - The user measures uplink headroom first, then concurrency and part size are chosen.
> - Do not touch the uploader settings yet.

### Exchange (verbatim)

Secrets in the original messages are redacted.

> [!quote|user] User · 2026-10-05 11:02:41
> ````text
> The S3 uploader is timing out on big files. Here is the current config:
>
> ```yaml
> uploader:
>   bucket: ingest-raw-prod
>   access_key_id: [REDACTED: AWS access key ID]
>   secret_access_key: [REDACTED: AWS secret access key]
>   part_size_mb: 5
>   timeout_s: 30
> ```
>
> What would you change?
> ````

> [!quote|agent] Agent · 2026-10-05 11:04:04
> ````text
> I'd switch large uploads to multipart with bigger parts and parallelism, and raise the per-request timeout:
>
> ```yaml
> uploader:
>   part_size_mb: 64
>   concurrency: 8
>   timeout_s: 120
> ```
>
> I'd also move the credentials out of the config file and into the instance role, since a key checked into config is a leak waiting to happen.
> ````

> [!quote|user] User · 2026-10-05 11:06:25
> ```text
> Credentials yes, move them to the instance role. But I don't want 8 concurrent parts - the gateway boxes share a 1 Gbps uplink with the API traffic and I've seen latency spikes when uploads saturate it. Let me measure the uplink headroom first before we pick concurrency and part size. Don't touch the uploader settings yet.
> ```

> [!quote|agent] Agent · 2026-10-05 11:07:22
> ```text
> Understood. I'll only move the credentials to the instance role now and leave `part_size_mb`, `concurrency` and `timeout_s` unchanged until you have the uplink measurements. I'll note the open question so we can pick values once you have numbers.
> ```

## 4. Reconciliation

| Setting | Proposed | Changed to | Why |
| --- | --- | --- | --- |
| `part_size_mb` | 64 | Unchanged at 5, pending | User picks it after measuring uplink headroom. |
| `concurrency` | 8 | Not added, pending | 8 parallel parts risk saturating the shared 1 Gbps uplink and spiking API latency. |
| `timeout_s` | 120 | Unchanged at 30, pending | User said not to touch the uploader settings yet. |
| Credentials | Move to instance role | Accepted | See [[uploader-s3-credentials]]. |

The agent accepted the hold without counter-argument.
No numbers have been agreed.

## 5. Final agreement

> [!success] Agreed rules
> 1. `part_size_mb` stays at 5 until the user supplies uplink headroom measurements and picks a new value.
> 2. No `concurrency` setting is added, and concurrency 8 is rejected for now.
> 3. `timeout_s` stays at 30 until the same decision.
> 4. Moving the credentials to the instance role does not count as permission to change any other `uploader` setting.

> [!todo] Open
> - User: measure the uplink headroom on the gateway boxes (shared 1 Gbps with API traffic).
> - User and agent: pick `part_size_mb`, `concurrency` and `timeout_s` from those numbers, then update this note to `agreed`.

### Implementation

Not implemented. No uploader tuning change is authorized yet.
