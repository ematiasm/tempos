# Delta for Locale and Formats

## MODIFIED Requirements

### Requirement: Single business locale

The system MUST resolve exactly one display locale for the whole business from
`BusinessSettings.default_locale` (persisted values `es` and `en`). Individual users MUST
NOT be able to override the display locale; there MUST be no per-user locale preference in
`localStorage` or in the database. Before a locale has been configured — while no
`BusinessSettings` row exists — the system MUST render in `en`, and the first-run setup
flow MUST offer the locale choice so the installer can select `es` instead. Screens that
render before authentication — login, password reset and sign-up — MUST resolve the locale
through the public value the API exposes for that purpose, so they follow the configured
locale instead of a fixed fallback.

(Previously: stated that the locale comes from `BusinessSettings.default_locale`, with no
behaviour defined for the state before it is configured, no scenario asserting that the
stored choice governs what a session renders, and no rule for the screens that cannot read
the settings because they render before authentication.)

#### Scenario: English before the business decides

- GIVEN no `BusinessSettings` row exists yet
- WHEN any screen is opened, including the first-run setup flow
- THEN it renders in English and the setup form still offers both locales

#### Scenario: The stored choice governs every session

- GIVEN the business `default_locale` is `en`
- WHEN any user opens the application in any browser or device
- THEN the UI renders in that locale, numbers and dates follow it, and no
  `tempos.locale` key is read or written

#### Scenario: Choosing Spanish in the wizard takes one click

- GIVEN the first-run setup flow
- WHEN the installer selects Spanish and completes it
- THEN the stored `default_locale` is `es` and every subsequent screen renders in Spanish

#### Scenario: The pre-authentication screens follow the configured locale

- GIVEN the business `default_locale` is `es` and no user is authenticated
- WHEN the login screen is opened
- THEN it renders in Spanish, resolved through the public locale the API exposes

#### Scenario: No per-user switch

- GIVEN the user opens User Settings
- WHEN they inspect the available preferences
- THEN no language selector is offered
