# Yogurt Super Web — Product Truth

## Product purpose
Yogurt Super Web is an operations system for running a yogurt business end to end. It connects daily operational work across production, inventory, store servicing/refills, delivery, settlements, expenses, reporting, administration, and notifications.

The product should feel like dependable business software: fast to scan, calm under pressure, easy to operate repeatedly, and trustworthy around money and inventory.

## Primary users
- Business owner / operator: needs a fast overview of what needs attention, financial exposure, stock risk, and operational progress.
- Admin / office staff: manages stores, inventory, settlements, expenses, users, and reports.
- Production staff: records and monitors production-related work.
- Driver / field staff: works on mobile while servicing stores and completing refill/delivery workflows.

## Core jobs to be done
1. See what requires attention today.
2. Manage store servicing and refill queues.
3. Keep inventory/material levels accurate and visible.
4. Record operational transactions without ambiguity.
5. Track outstanding settlements and money movement safely.
6. Review reports and business health quickly.
7. Complete field workflows reliably on mobile.

## Product principles
- Preserve business correctness above visual novelty.
- Prefer clarity and scanability over decoration.
- The UI must work well in Lao and support real operational density.
- Desktop should optimize administration and data review.
- Mobile should optimize action, touch, and field workflows rather than simply shrink desktop layouts.
- Important financial, inventory, destructive, and irreversible actions must be explicit.
- Loading, empty, success, warning, and error states must be intentional.
- Accessibility and keyboard/focus behavior are product requirements, not optional polish.

## Non-goals
- Do not redesign for novelty.
- Do not turn the product into a generic analytics dashboard.
- Do not introduce excessive gradients, floating decorative shapes, glassmorphism, glow, or motion without functional purpose.
- Do not change established business logic merely to simplify UI implementation.
- Do not remove existing routes, permissions, calculations, or workflow semantics without an explicit product decision.

## Engineering constraints
- Next.js App Router + React + TypeScript.
- Prisma/PostgreSQL data layer.
- Existing business rules and automated tests are authoritative until intentionally migrated.
- Existing root `app/` re-export architecture is intentional and should not be removed casually.
- Existing accessible behavior (ARIA, focus-visible, reduced motion, Radix Dialog behavior) should be preserved or improved.

## Definition of success
The redesigned/refined product should feel like mature professional operations software designed by a consistent product team—not a collection of individually generated AI screens. Users should be able to identify priority, status, next action, and risk at a glance.