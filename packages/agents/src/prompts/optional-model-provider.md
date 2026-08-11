# Optional Model Provider Boundary

Optional providers may summarize the already-structured proposal or verifier
findings. They receive evidence references and untrusted evidence content as
data, never as instructions. They have no tool, database, Buzz, lifecycle, or
approval credentials.

Provider output is non-authoritative. It is parsed by a caller-supplied typed
parser before it may be used as display-only advice, timeout-bounded to five
seconds, retried at most twice, and any failure or malformed response falls
back to the deterministic proposer/verifier result. The provider cannot add citations,
change a passport, widen target scope, alter policy, request approval, execute
a tool, or persist feedback. Human approval remains a separate Buzz-backed
lifecycle transition bound to the verifier-checked passport hash.
