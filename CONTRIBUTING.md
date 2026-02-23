# Contributing to Aegis Node

Thanks for taking the time to contribute to Aegis Node.

This is currently a small project, but contributions, ideas, and feedback are very welcome. The guidelines below are meant to keep things consistent and secure, not to be overly strict.

---

## Ways to Contribute

### Reporting Bugs

If you encounter a bug:

- Check existing issues first to avoid duplicates.
- If it hasn’t been reported, open a new issue and include:
  - A short summary of the issue
  - Steps to reproduce
  - Expected behavior
  - Actual behavior
  - Relevant environment details (OS, WireGuard client, etc.)

Clear reports make fixing issues much easier.

---

### Suggesting Improvements

Have an idea for a feature or improvement?

Open an issue and describe:

- What you’d like to see
- Why it would improve the project
- Any potential implementation thoughts (optional)

Discussion before large changes is appreciated.

---

### Pull Requests

If you’d like to submit a PR:

1. Fork the repository and branch from `main`.
2. Keep changes focused and scoped.
3. Update documentation if behavior changes.
4. Test your changes to avoid regressions.
5. Reference related issues where applicable.

Security-related changes should be explained clearly.

---

## Development Notes

### Ansible

The playbooks aim to stay:

- Idempotent  
- Minimal  
- Security-oriented  

Please keep variables in `group_vars/all.yml` (or role defaults where appropriate) and avoid hardcoding values inside tasks.

---

### Control Plane (FastAPI)

- Follow PEP 8 conventions.
- Prefer explicit typing where reasonable.
- Avoid unnecessary dependencies.
- Keep the attack surface small.

---

### Frontend

The frontend intentionally avoids heavy frameworks.

Please avoid introducing large dependencies unless there's a strong justification discussed beforehand.

---

## Design Philosophy

Aegis Node prioritizes:

- Minimal attack surface  
- Explicit security boundaries  
- Clear separation of control plane and data plane  
- Simplicity over feature creep  

If a change increases complexity, it should meaningfully improve security or operability.

---

Thanks again for your interest in improving the project.