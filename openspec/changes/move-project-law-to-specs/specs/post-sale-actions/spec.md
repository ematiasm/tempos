# Delta for Post-Sale Actions

## REMOVED Requirements

### Requirement: Client regeneration after OpenAPI changes

(Previously: "After any backend change that alters the OpenAPI shape in this capability
(document notes fields, email endpoint), the frontend client MUST be regenerated with
`bash ./scripts/generate-client.sh` and the frontend typecheck MUST pass.")

(Reason: this states a build process that was already completed for this capability, not
ongoing system behaviour. As a canonical requirement it can never fail again, so it is
noise in a spec that should describe what the system does. The process itself is still
mandatory and remains stated once — by name — in the project index, with the exact
command owned by `openspec/config.yaml`.)

(Migration: the regenerated client for the notes and email contract is already committed
under `frontend/src/client/`; no consumer or data migration follows from the removal.
The removed scenario is replaced by the index rule, which applies to every capability
instead of one.)
