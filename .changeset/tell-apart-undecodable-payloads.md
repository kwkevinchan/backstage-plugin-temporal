---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

Tell apart the payloads the plugin cannot decode. The page now says whether a payload is encrypted (`binary/encrypted`, with its key ID), binary data, protobuf binary (with its message type), invalid JSON, or in a custom encoding, and lists its metadata. Query and update results that cannot be decoded now carry `metadata` too.
