# Ledger's Hoard

## App Dock

When opened beside a Faustus chat, this page registers `ledger_open`, `ledger_filter`, `ledger_view` through `window.HoardApp`. These tools resolve records by id or unique name, apply the app's filters and switch sections. Ambiguous names return candidates. The current section, focused movement or editor, and active view filters are reported. Account and category filters accept ids or unique names.

`dock/changed` refreshes the mounted views without a page reload. Existing pending form fields are retained by the app's refresh handlers. The standalone interface continues to use its normal routes and controls. The Dock tools are exposed through the host's `app_view` and `app_act`; the existing backend tool catalogue is unchanged.


## Collection mail service

`receivable_send` and the Cobros Enviar control use `mailSend(..., {mode:"send"})` from shared `fam-services.js`. Only `ok:true, state:"sent", sent:true` marks the notice sent. Errors, saved drafts and uncertain SMTP replies retain its editable text and error for review. Concurrent sends of one notice are rejected, as are discarded notices and reminders for paused/paid invoices (a thank-you draft for a paid invoice is valid).

`receivables.auto_send` is false by default and is editable in Plazos y tono / PUT /api/receivables/settings. Enabling it sends new notices only; it does not resend existing drafts or day-14 escalations. The person must request a manual send or enable that option. Incoming mail still uses its existing router. The shared mail service supports remote drafts and attachments through Hub tools; Cobros sends its existing notice text.
