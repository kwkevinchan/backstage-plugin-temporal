/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Temporal payload codec that stores large payloads in an S3-compatible
 * service and keeps a claim check in the workflow history.
 *
 * @packageDocumentation
 */

export {
  CLAIM_CHECK_ENCODING,
  CLAIM_CHECK_VERSION,
  detectContentType,
  isClaimCheckPayload,
  parseClaimCheck,
  sha256Hex,
  validateClaimCheck,
} from './claimCheck';
export type { ClaimCheck, Payload } from './claimCheck';
export {
  ClaimCheckIntegrityError,
  claimCheckKey,
  createS3DataConverter,
  DEFAULT_KEY_PREFIX,
  DEFAULT_THRESHOLD_BYTES,
  S3PayloadCodec,
  verifyAndRestore,
} from './codec';
export type {
  PayloadCodecContext,
  PayloadCodecLike,
  S3PayloadCodecOptions,
} from './codec';
export { S3PayloadStore } from './S3PayloadStore';
export type {
  S3PayloadStoreOptions,
  StoredObjectStream,
} from './S3PayloadStore';
