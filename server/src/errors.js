// SPDX-License-Identifier: MIT
// ALIAS, not a copy — the whole error implementation lives in the kit
// (`@delebash/llm-runner/platform/errors`; the port of justvoice/errors.py). This module
// exists so the route/domain files importing `notFound` etc. from "../errors.js" keep
// working against the ONE family implementation; there is no logic here to drift.
// Handlers are registered by the app via `installErrorHandlers(app, {typeBase})` (or
// `createServer({typeBase})`).

export {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  HttpError,
  internal,
  notFound,
  notImplemented,
  serviceUnavailable,
  unauthorized,
} from "@delebash/llm-runner/platform/errors";
