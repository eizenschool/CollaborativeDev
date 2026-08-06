# CollaborativeDev
Let's Tumpang — Coding Standards & Git Workflow

Revision note: This version corrects three places where the previous draft'snaming/architecture examples didn't match what the Module 1 prototype (carshare-pwazip) established. Since §1.1 states the standard maps onto "the three-tierstructure already established by the Module 1 prototype," the document is correctedto describe that prototype accurately, rather than the prototype being rewritten tofit the earlier (incorrect) examples. Changes are marked [CORRECTED] below;everything else is unchanged from the original draft.



Coding Standards

1.1 Architecture

Every module's code must map into the three-tier structure already established by theModule 1 prototype:





Rule: the GUI layer never calls Supabase directly and never imports anything fromdata-access/. All reads/writes go through a business-logic service function.



[CORRECTED] The original draft described data-access/ as the only layer allowedto "touch Supabase," implying a repository pattern (business-logic calls a data-accessfunction, which calls Supabase). That is not what Module 1 actually does — everyservice in business-logic/ (AuthService, ProfileService, VehicleService,HostImpactEngine) imports the raw supabase client from data-access/supabaseClient.jsand writes its own .from(...) queries inline. supabaseClient.js's own header commentconfirms this is intentional: "Only src/business-logic/* service modules may importsupabaseClient." The real dividing line Module 1 enforces is presentation vs.everything else, not data-access vs. everything else. The table above nowreflects that.



1.2 Naming Conventions





[CORRECTED] The original draft's business-logic example (validateRideRequest.js,implying one exported verb-first function per file) and data-access example(rideRepository.js, implying a noun + Repository repository-per-domain pattern)don't match any file in the Module 1 prototype. The established pattern is a singleService object per business domain (export const XService = { async methodOne(), async methodTwo(), ... }), and a Client/Store pair in data-access/ shared acrossevery service rather than one repository file per domain. Module 2–6 authors shouldfollow the corrected examples so new modules read consistently with Module 1, not theother way around.



1.3 Formatting & Structure

2-space indentation, no tabs.

Single quotes for JS strings, double quotes for JSX attributes.

One exported/routable component per file, file name matches the component name.Small private sub-components used only by that screen (e.g. a form split intovisual sections) may live in the same file as long as they aren't imported anywhereelse — once a sub-component is reused or the file is doing more than one screen'sworth of work, split it into its own file under a subfolder named for the parentscreen.

Every business-logic function must have a short JSDoc comment stating what it doesand what it returns.

No hardcoded strings for status values — use shared constants (e.g.TRIP_STATUS.DRAFT, not "Draft" typed inline) so all modules reference the sameenum and stay in sync.



1.4 Shared Enums (preventing cross-module drift)

Any status/enum field used by more than one module must live in a single shared file(src/shared/constants.js) and be imported — not retyped — by every module that usesit. This directly addresses the current mismatch where Trip Lifecycle values areduplicated with different names across FR-2.9, the Trip Lifecycle Component, andModule 6.



Git Workflow

(Diagram: branching model, merge direction, and PR flow for Sprint 1 — see originalfile's media/image1.png.)



2.1 Key Rules

No direct commits to main or dev — all work happens onfeature/moduleX-description branches.

Every feature branch opens a Pull Request into dev; at least one reviewer approvesbefore merge.

dev merges into main only when the build is stable and demo-ready.

Commit format: [ModuleX] short imperative description — e.g.[Module6] implement PIN generation.



2.2 Issue Tracking

Use GitHub Issues or the Trello board — one card per FR/task from the ProductBacklog.

Card title should match the FR number, e.g. FR-2.3 — Ride publish form.

Move cards through: Backlog → In Progress → In Review → Done.
