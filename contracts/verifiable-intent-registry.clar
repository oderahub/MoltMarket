;; verifiable-intent-registry.clar
;; Minimal registry/attestation anchor for MoltMarket Wave 2.
;; Intentionally thin: stores intent hashes and optional attestation hashes.
;; No escrow, no settlement custody, no protocol-level execution logic.

(define-constant err-already-registered (err u100))
(define-constant err-not-found (err u101))
(define-constant err-not-owner (err u102))

(define-map intents
  { intent-hash: (buff 32) }
  {
    owner: principal,
    intent-id: (string-utf8 128),
    skill-id: (string-utf8 64),
    created-at: uint,
    attestation-hash: (optional (buff 32))
  }
)

(define-public (register-intent
  (intent-hash (buff 32))
  (intent-id (string-utf8 128))
  (skill-id (string-utf8 64))
)
  (begin
    (asserts! (is-none (map-get? intents { intent-hash: intent-hash })) err-already-registered)
    (map-set intents
      { intent-hash: intent-hash }
      {
        owner: tx-sender,
        intent-id: intent-id,
        skill-id: skill-id,
        created-at: block-height,
        attestation-hash: none
      }
    )
    (ok { intent-hash: intent-hash, owner: tx-sender })
  )
)

(define-public (set-attestation
  (intent-hash (buff 32))
  (attestation-hash (buff 32))
)
  (match (map-get? intents { intent-hash: intent-hash }) current
    (begin
      (asserts! (is-eq tx-sender (get owner current)) err-not-owner)
      (map-set intents
        { intent-hash: intent-hash }
        (merge current { attestation-hash: (some attestation-hash) })
      )
      (ok { intent-hash: intent-hash, attestation-hash: attestation-hash })
    )
    err-not-found
  )
)

(define-read-only (get-intent (intent-hash (buff 32)))
  (ok (map-get? intents { intent-hash: intent-hash }))
)