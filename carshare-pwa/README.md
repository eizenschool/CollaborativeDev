# Let's Tumpang
# Coding Standards & Git Workflow

Version: 2.0

This document defines the coding standards, naming conventions, project architecture, and Git workflow adopted by the Let's Tumpang project. All team members shall follow these standards to ensure consistency, maintainability, and collaboration throughout the development process.

---

# 1. Coding Standards

## 1.1 Architecture

Every module shall follow the three-tier architecture adopted by the project.

```
Presentation Layer
        ↓
Business Logic Layer
        ↓
Data Access Layer
        ↓
Supabase
```

### Layer Responsibilities

| Layer | Responsibility |
|--------|----------------|
| presentation/ | React pages, screens, forms and UI components. No direct Supabase calls. |
| business-logic/ | Validation, business rules, data processing and orchestration. |
| data-access/ | Supabase queries, insert, update and delete operations only. |

### Architecture Rules

- Presentation Layer shall never communicate directly with Supabase.
- Presentation Layer shall only communicate with Business Logic.
- Business Logic shall communicate with Data Access.
- Data Access shall be the only layer allowed to access Supabase.
- Each layer shall only communicate with its adjacent layer.

---

## 1.2 Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | RidePublishForm.jsx |
| Business Logic Files | camelCase, verb-first | validateRideRequest.js |
| Data Access Files | camelCase, noun + Repository | rideRepository.js |
| Variables | camelCase | rideStatus |
| Functions | camelCase | getUserReputation() |
| Constants | UPPER_SNAKE_CASE | MAX_SEATS |
| Database Tables | snake_case, plural | ride_requests |
| Database Columns | snake_case | pickup_location |

### Boolean Variables

Boolean variables shall begin with:

- is
- has
- can

Example

```javascript
isVerified
hasVehicle
canPublishRide
```

### Array Variables

Arrays shall use plural nouns.

Example

```javascript
rideRequests
tripHistory
chatMessages
```

### Event Handlers

Event handler functions shall begin with **handle**.

```javascript
handleLogin()
handlePublishRide()
handleSendMessage()
```

### CRUD Functions

Use consistent CRUD naming.

```javascript
fetchRideHistory()
createRide()
updateVehicle()
deleteMessage()
```

---

## 1.3 Formatting & Structure

### Indentation

- Use 2 spaces.
- Do not use tabs.

### Quotation

- Single quotes for JavaScript strings.
- Double quotes for JSX attributes.

### Components

- One component per file.
- File name shall match the component name.

### Documentation

Business Logic functions should include a short JSDoc comment.

Example

```javascript
/**
 * Validate ride request.
 * @returns {Boolean}
 */
```

### Shared Constants

Do not hardcode status values.

Incorrect

```javascript
"Draft"
```

Correct

```javascript
TRIP_STATUS.DRAFT
```

### Import Order

Imports shall follow this order:

1. React
2. Third-party libraries
3. Shared utilities
4. Local components
5. CSS

---

## 1.4 Shared Enums

Shared status values shall be defined inside

```
src/shared/constants.js
```

Examples

- TRIP_STATUS
- REPORT_STATUS
- USER_ROLE
- MESSAGE_TYPE

All modules shall import these shared constants instead of redefining them.

---

## 1.5 Error Handling

- Validate user input before processing.
- Display user-friendly error messages.
- Do not expose technical errors directly to users.

Good

```
Unable to publish ride.

Please try again.
```

Bad

```
Supabase Error 23505
```

---

## 1.6 Security

- Store API Keys inside `.env`.
- Never commit `.env` to GitHub.
- Never hardcode API Keys.
- Authenticate users before accessing protected resources.
- Follow Supabase Row Level Security (RLS) configuration where applicable.

---

## 1.7 Documentation

Developers should

- write meaningful comments for complex logic.
- update documentation after major feature implementation.
- maintain consistent naming across all modules.

---

# 2. Git Workflow

The Let's Tumpang project follows a module-based Git workflow.

```
                 main
                   ▲
                   │
             development
      ▲      ▲      ▲      ▲      ▲      ▲
      │      │      │      │      │      │
 Module1 Module2 Module3 Module4 Module5 Module6
```

---

## 2.1 Branch Strategy

Each module shall have its own development branch.

Example

```
main

development

Module1_User_Profile_&_Reputation

Module2_Ride_Sharing_Management

Module3_Messaging

Module4_Smart_Search_&_Favourite

Module5_Trip_Management_&_Eco_Impact

Module6_Safety_&_Verification
```

---

## 2.2 Development Flow

```
Create Module Branch

↓

Develop Feature

↓

Commit

↓

Push

↓

Merge into Development

↓

Testing

↓

Merge into Main
```

---

## 2.3 Key Rules

- No direct commits to the **main** branch.
- Each developer shall work only in the assigned module branch.
- Completed features shall be merged into the **development** branch.
- The **development** branch shall be tested before merging into **main**.
- Only stable and demo-ready builds may be merged into **main**.

---

## 2.4 Commit Convention

Commit messages should be meaningful and include the module identifier.

Examples

```
[Module1] Implement user registration

[Module2] Add publish ride validation

[Module3] Implement send message feature

[Module4] Add search filters

[Module5] Implement trip history

[Module6] Fix hazard reporting validation
```

---

## 2.5 Pull Request

Every completed module feature should

- create a Pull Request to **development**
- include a clear description
- include testing evidence where applicable
- be reviewed before merging

---

## 2.6 Issue Tracking

Each GitHub Issue (or Trello card) represents one Functional Requirement (FR).

Example

```
FR-2.3 – Ride Publish Form
```

Workflow

```
Backlog

↓

In Progress

↓

In Review

↓

Done
```

Each completed Issue should correspond to its related commits or Pull Request whenever applicable.

---

# 3. Definition of Done

A task is considered completed only when:

- Coding standards are followed.
- Functionality has been implemented.
- Code has been tested.
- No critical errors remain.
- Documentation has been updated.
- Changes have been merged into the development branch.
- Development branch has passed integration testing before merging into main.