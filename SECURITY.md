# Security Policy

## Supported Versions

Only the latest release line receives security updates. Patch releases for
vulnerabilities affecting it are published as soon as fixes are ready.

| Version | Supported |
| ------- | --------- |
| 0.7.x   | Yes       |
| < 0.7   | No        |

## Reporting a Vulnerability

Report vulnerabilities privately through GitHub private vulnerability
reporting on the repository's Security tab. Do not open a public issue for a
security vulnerability.

Include a minimal reproduction, the affected version, and a description of the
impact. You can expect an acknowledgment within 5 business days and a status
update on the fix timeline.

## Scope

Prime Agent executes model-generated Python and project commands with your
user permissions. Worker and kernel processes improve lifecycle isolation and
recovery; they are not a security sandbox. Review changes and use trusted
repositories, instructions, skills, and extensions only.
