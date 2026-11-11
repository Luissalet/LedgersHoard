# Ledger's Hoard

## App Dock

When opened beside a Faustus chat, this page registers `ledger_open`, `ledger_filter`, `ledger_view` through `window.HoardApp`. These tools resolve records by id or unique name, apply the app's filters and switch sections. Ambiguous names return candidates. The current section, focused movement or editor, and active view filters are reported. Account and category filters accept ids or unique names.

`dock/changed` refreshes the mounted views without a page reload. Existing pending form fields are retained by the app's refresh handlers. The standalone interface continues to use its normal routes and controls. The Dock tools are exposed through the host's `app_view` and `app_act`; the existing backend tool catalogue is unchanged.
