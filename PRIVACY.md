# Privacy Policy — Registry Versions

Last updated: 18 August 2026

Registry Versions is a Chrome extension that lists the repositories and image
tags in the private Docker Registry v2 endpoints you configure.

## What it stores

- **Registry configuration** — the registry name and URL you enter.
- **Registry credentials** — the username and password or access token you enter
  for each registry.
- **A short-lived listing cache** — repository and tag names returned by your
  registry, held for five minutes in memory-only session storage and cleared when
  the browser closes.

All of it is kept in Chrome's local extension storage on your own device.

## Where it is sent

Your credentials are sent to one place only: the registry you configured, as an
HTTP `Authorization` header on requests to that registry's `/v2/` endpoints.

The extension contacts no other server. There is no analytics, no telemetry, no
crash reporting, and no third-party service of any kind. Nothing is transmitted
to the developer.

## What it does not do

- Does not sell or transfer your data to third parties.
- Does not use your data for anything unrelated to listing your registry.
- Does not use your data for creditworthiness or lending purposes.
- Does not read the pages you browse. It has no content scripts and requests
  access only to the specific registry hosts you add.

## Host access

Access to a registry host is requested at runtime, per registry, and only after
you add that registry in the options page. You can revoke it at any time from
`chrome://extensions`.

## Removing your data

Deleting a registry in the options page removes its stored configuration and
credentials. Uninstalling the extension removes everything it has stored.

## A note on credential storage

Chrome provides extensions no secure keystore, so credentials are stored in plain
text within your browser profile. Anyone with read access to that profile
directory can recover them. Prefer a pull-only robot or CI token over a personal
password.

## Contact

Questions about this policy: <!-- add your contact email here -->
