# Dataset

This directory contains **15 unstructured messages** belonging to **2 fictional customers**. The messages arrive through three different channels and are presented in **non-chronological order**.

## Customers

| Customer | Key Identifiers |
|---|---|
| Customer A | Maria García López — Spanish, DOB 1985-03-14, Tax ID 12345678A |
| Customer B | Thomas Weber — German, DOB 1978-07-22, Tax ID 65 432 187 909 |

## Message Timeline (chronological)

| Date | ID | Source | Customer | Key Data Points |
|---|---|---|---|---|
| 2025-01-15 | doc-001 | Document | A | Initial application — full personal details, Madrid address |
| 2025-02-14 | msg-001 | Message | B | First contact — name, old phone, freelance, hobbies |
| 2025-03-01 | doc-002 | Document | B | Registration — full personal details, Berlin address |
| 2025-03-10 | email-001 | Email | A | Inquiry — name, Madrid address, old email/phone |
| 2025-04-01 | msg-004 | Message | A | Confirms DOB, nationality, tax ID, Madrid address |
| 2025-04-05 | email-002 | Email | B | Health inquiry — DOB, Berlin address, phone preference |
| 2025-05-15 | doc-004 | Document | B | Meeting notes — hobbies, preferences, family context |
| 2025-05-20 | msg-002 | Message | A | Lifestyle info — non-smoker, hobbies, email preference |
| 2025-06-01 | msg-003 | Message | B | Family context — divorced, son Lukas, photography |
| 2025-06-15 | email-003 | Email | A | **Address change** to Munich, new employer, new email |
| 2025-07-01 | doc-003 | Document | A | Formal address change, new phone, married |
| 2025-07-20 | email-004 | Email | B | New employer, new phone, investment interest |
| 2025-08-15 | msg-005 | Message | B | Motorcycle purchase, urgency about health coverage |
| 2025-09-01 | email-005 | Email | A | Married, two stepchildren, retirement planning |
| 2025-09-10 | doc-005 | Document | B | **Address change** in Berlin, employer confirmed, motorcycle |

## Data Conflict Scenarios

The dataset includes deliberate conflicts that must be resolved by `messageDate`:

### Customer A — Maria García López
- **Address**: Madrid (Jan–Apr) → Munich (Jun onwards)
- **Email**: m.garcia85@gmail.com (Jan) → maria.garcia@email.com (Jun onwards)
- **Phone**: +34 612 345 678 (Jan) → +49 171 2345678 (Jul onwards)
- **Employer**: MadridSoft S.L. (Jan) → TechCorp GmbH (Jun onwards)
- **Marital Status**: Single (Jan) → Married (Jul onwards)

### Customer B — Thomas Weber
- **Address**: Friedrichstraße 42, Berlin (Mar) → Prenzlauer Allee 88, Berlin (Sep)
- **Phone**: +49 30 9876543 (Feb) → +49 151 7654321 (Jul onwards)
- **Employer**: Freelance (Feb) → FinanzBeratung AG (Jul onwards)
- **Child's age**: 11 (Mar) → 12 (May, Jun) — natural aging, not a conflict

## Expected Outcome

After processing all 15 messages, the system should produce two complete customer profiles with:
- The **latest values** for all mutable fields
- **Full history** of all changes with timestamps and source references
- **Accumulated** non-deterministic data (hobbies, preferences, needs, etc.)
