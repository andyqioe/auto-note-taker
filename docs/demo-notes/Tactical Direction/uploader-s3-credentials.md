---
status: agreed
created: 2026-10-05T13:27:19
updated: 2026-10-05T13:38:57
tags: [tactical-direction, uploader/credentials]
aliases: ["Move S3 uploader credentials from the config file to the instance role"]
implementation:
cssclasses: [agent-note]
---

# Move S3 uploader credentials from the config file to the instance role

> [!success|banner] Agreed 2026-10-05 13:38:57
> Remove `access_key_id` and `secret_access_key` from the `uploader` config and authenticate through the instance role.
> Change nothing else in the `uploader` block as part of this move.

## 1. Context

- Project: `ingest-gateway`.
- The `uploader` config holds static AWS keys (`access_key_id`, `secret_access_key`) next to `bucket: ingest-raw-prod`.
- The credentials came up while discussing S3 upload timeouts on big files; the tuning side is pending in [[uploader-s3-multipartTuning]].

## 2. Agent Proposal

> [!abstract] Proposed
> Move the credentials out of the config file and into the instance role, since a key checked into config is a leak waiting to happen.

## 3. User Disagreement

No disagreement on this point.
The user accepted the proposal directly ("Credentials yes, move them to the instance role.").
The same message limited the scope: the other uploader settings must not be touched yet.

> [!warning] User direction
> Do only the credentials move now; leave `part_size_mb`, `concurrency` and `timeout_s` as they are.

### Exchange (verbatim)

Secrets in the original messages are redacted.

> [!quote|user] User · 2026-10-05 13:27:19
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

> [!quote|agent] Agent · 2026-10-05 13:28:42
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

> [!quote|user] User · 2026-10-05 13:31:03
> ```text
> Credentials yes, move them to the instance role. But I don't want 8 concurrent parts - the gateway boxes share a 1 Gbps uplink with the API traffic and I've seen latency spikes when uploads saturate it. Let me measure the uplink headroom first before we pick concurrency and part size. Don't touch the uploader settings yet.
> ```

> [!quote|agent] Agent · 2026-10-05 13:32:00
> ```text
> Understood. I'll only move the credentials to the instance role now and leave `part_size_mb`, `concurrency` and `timeout_s` unchanged until you have the uplink measurements. I'll note the open question so we can pick values once you have numbers.
> ```

## 4. Reconciliation

The proposal was accepted as made, with the scope narrowed by the user to the credentials only.

## 5. Final agreement

> [!success] Agreed rules
> 1. The `uploader` config contains no `access_key_id` or `secret_access_key`.
> 2. The uploader obtains AWS credentials from the gateway instance role.
> 3. `bucket`, `part_size_mb` and `timeout_s` keep their current values in this change, and no `concurrency` key is added.

> [!todo] Open
> - Not discussed: whether to rotate or revoke the static key that was stored in the config file and pasted into the chat. Raised here by the agent for the user to decide; not agreed.

### Implementation

Not implemented yet.
