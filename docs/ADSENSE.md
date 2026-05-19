# Google AdSense Configuration

The app supports Google AdSense through Vite environment variables. Only the public
publisher client belongs in browser-delivered configuration.

## Safe value for frontend configuration

Set the public publisher client in local or deployment environment variables:

```bash
VITE_ADSENSE_CLIENT=ca-pub-8165457408564080
```

Optionally set a public ad slot ID:

```bash
VITE_ADSENSE_SLOT=your_ad_slot_id
```

## Values that must not be committed

Do not commit Google Ads customer IDs, payments profile IDs, payments account IDs, tax
information, bank details, or identity-verification data. Those belong only in private
Google account administration and secrets-management systems.

## Placement rule

Ads must never cover wallet prompts, fee disclosures, legal move controls, settlement
confirmations, mute controls, or dispute/refund actions.
