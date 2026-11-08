# certs

`timescale-ca.pem` is the Tiger Cloud (Timescale) private root CA, `CN=ca.timescale.com`,
valid until 2027-10-20, SHA-256 fingerprint
`06:5A:75:0D:0D:64:F6:2D:AC:DC:97:9E:3B:83:D2:11:95:40:71:EA:59:B8:F3:40:7C:4E:87:CA:68:34:64:57`.

Tiger Cloud free services are signed by this private CA rather than a public one, so Node's
bundled trust store rejects the chain. Pointing `DATABASE_SSL_CA` at this file makes `pg`
verify the full chain and the hostname (the equivalent of libpq `sslmode=verify-full`),
instead of disabling verification.

It is a public certificate (every client receives it in the TLS handshake); it contains no secret.
Captured with:

    openssl s_client -showcerts -starttls postgres -connect <HOST>:<PORT>

per https://www.tigerdata.com/docs/use-timescale/latest/security/strict-ssl
