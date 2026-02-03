# Process Flows

This page diagrams the typical flows for Submitters (Users) and Reviewers.

> Note: These are Mermaid diagrams. In VS Code, use Markdown Preview to render; optionally install a Mermaid preview extension.

## Submitter flow
```mermaid
flowchart TD
  A[Start: Open Generator] --> B[Select preset / fill header]
  B --> C[Add credit transactions]
  C --> D{Issues?}
  D -- Yes --> X[Fix blocked BSB/Account, Fill Lodgement Ref]
  X --> C
  D -- No --> E[Generate ABA]
  E --> F[Submission modal: PD, Preparer, Notes]
  F --> G[Submit]
  G --> H[Batch stored]
  H --> I[Archive visible to reviewers]
```

## Reviewer flow
```mermaid
flowchart TD
  R1[Start: Reviewer tab] --> R2[Find batch in Archives or Retrieve by code]
  R2 --> R3[Summary shows preset + account]
  R3 --> R4[Open in Reader]
  R4 --> R5{Validations & Duplicates OK?}
  R5 -- Yes --> R6[Decision: Approve]
  R5 -- Needs changes --> R7[Decision: Reject w/ comments]
  R6 --> R8[File downloadable]
  R7 --> R9[Submitter fixes & resubmits]
```

## Reader inspection (detail)
```mermaid
sequenceDiagram
  participant Reviewer
  participant App as App (Reader)
  Reviewer->>App: Open in Reader
  App-->>Reviewer: Parse Header (Type 0), Control (Type 7)
  App-->>Reviewer: List Transactions (Type 1)
  App-->>Reviewer: Highlight duplicates, show preset & account
  Reviewer->>App: (Optional) Load into Generator
```
