# Sprint 3 Plan — [Team Name]

**Sprint:** 3 — Reliability and Poison Pills  
**Dates:** 04.21 → 04.28  
**Written:** 04.21 in class

---

## Goal

[What reliability improvements and poison pill handling will your team add? Which queues get DLQ handling?]

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| [Name]      | `[path]` |
| [Name]      | `[path]` |
| [Name]      | `[path]` |

---

## Tasks

### [Maycol]

- [ ] dlq for ticket purchase service

### [Ayo]

- [ ] analytics worker +analytics DB + dlq

### [Sean]

- [ ] event catalog frontend

### [Brian]

- [ ] purchase screen

### [Lucky]

- [ ] payment screen

### [Derek]

- [ ] k6 poison pill tests

### [Jimmy]

- [ ] fraud detection worker + fraud detection worker DB + dlq

### [Sean]

- [ ] event catalog frontend

### [Mateus]

- [ ] Graceful failures


---

## Risks

---

## Definition of Done

After injecting poison pills, the worker's `/health` shows non-zero `dlq_depth` while status remains `healthy`. Good messages keep flowing. k6 results show throughput does not collapse.
