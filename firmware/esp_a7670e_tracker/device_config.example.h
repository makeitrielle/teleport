#pragma once
// Copy to device_config.h (ignored by Git), then configure this bus's actual key.
#define TELEPORT_DEVICE_KEY "replace-with-key-generated-by-administrator"
// Current trusted root CA for SERVER_HOST, as PEM. Never use setInsecure in production.
#define TELEPORT_CA_CERT R"PEM(
-----BEGIN CERTIFICATE-----
replace-with-the-actual-trusted-root-certificate
-----END CERTIFICATE-----
)PEM"
