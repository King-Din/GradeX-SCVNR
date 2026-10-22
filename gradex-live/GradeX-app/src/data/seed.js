import bcrypt from "bcrypt";
import { formatId } from "./schema.js";

/*
 * Demo data (DEMO_MODE=true). Every account's password is DEMO_PASSWORD.
 *
 * The sample club follows the hierarchy: 2 admins, an EB head per domain,
 * coordinators with their own teams of volunteers. Design has the full
 * history at both levels: EB tasks delivered by coordinators (scored by the
 * EB head) and the team tasks they forwarded (scored by the coordinator).
 *
 * Dates are relative to "now" so the demo always has current deadlines and a
 * realistic history of on-time, late and missed work.
 */
export const DEMO_PASSWORD = "password123";

const DAY = 24 * 60 * 60 * 1000;

// Placeholder domains, also used when a real store is created.
const DOMAINS = [
  { id: "D001", name: "Design" },
  { id: "D002", name: "PR & Marketing" },
  { id: "D003", name: "Operations" }
];

// [name, email, role, domainId, coordinator's email (volunteers)]
const PEOPLE = [
  ["Asha Rao", "admin@example.com", "ADMIN", null],
  ["Vikram Shah", "admin2@example.com", "ADMIN", null],
  ["Priya Sharma", "eb.design@example.com", "EB", "D001"],
  ["Rohan Mehta", "eb.pr@example.com", "EB", "D002"],
  ["Sneha Patel", "eb.ops@example.com", "EB", "D003"],
  ["Ravi Kumar", "coordinator@example.com", "COORDINATOR", "D001"],
  ["Lakshmi Prasad", "coordinator2@example.com", "COORDINATOR", "D001"],
  ["Arvind Nair", "coordinator.pr@example.com", "COORDINATOR", "D002"],
  ["Sameer Ali", "coordinator.ops@example.com", "COORDINATOR", "D003"],
  ["Meena Iyer", "volunteer@example.com", "VOLUNTEER", "D001", "coordinator@example.com"],
  ["Kavya Reddy", "kavya@example.com", "VOLUNTEER", "D001", "coordinator@example.com"],
  ["Arjun Das", "arjun@example.com", "VOLUNTEER", "D001", "coordinator@example.com"],
  ["Sai Teja", "saiteja@example.com", "VOLUNTEER", "D001", "coordinator@example.com"],
  ["Varun K", "varun@example.com", "VOLUNTEER", "D001", "coordinator2@example.com"],
  ["Divya S", "divya@example.com", "VOLUNTEER", "D001", "coordinator2@example.com"],
  ["Harini V", "harini@example.com", "VOLUNTEER", "D001", "coordinator2@example.com"],
  ["Nikhil P", "nikhil@example.com", "VOLUNTEER", "D002", "coordinator.pr@example.com"],
  ["Ananya K", "ananya@example.com", "VOLUNTEER", "D002", "coordinator.pr@example.com"],
  ["Rahul V", "rahul@example.com", "VOLUNTEER", "D002", "coordinator.pr@example.com"],
  // Shows the first-login flow: set a password, choose a domain, then a coordinator.
  ["Pooja M", "newvolunteer@example.com", "VOLUNTEER", null]
];

// The sample accounts. In demo mode they can't be changed (anyone knows the
// password), except the first-login account, which a reset restores.
export const DEMO_EMAILS = new Set(PEOPLE.map(([, email]) => email));
export const DEMO_FIRST_LOGIN_EMAIL = "newvolunteer@example.com";

const emptyTables = () => ({
  Users: [], Domains: [], Tasks: [], Participations: [], Submissions: [], Evaluations: [], PushSubscriptions: [], NotificationLog: []
});

const blankDecision = { decision: null, decisionNote: null, decisionBy: null, decisionAt: null };

/*
 * A new real store: the domains plus one admin from BOOTSTRAP_ADMIN_EMAIL /
 * BOOTSTRAP_ADMIN_PASSWORD, who must change that password at first login.
 * With no bootstrap admin there are no accounts at all.
 */
export function buildBootstrap({ adminEmail, adminPassword, now = Date.now() } = {}) {
  const tables = { ...emptyTables(), Domains: DOMAINS.map((d) => ({ ...d })) };
  if (adminEmail && adminPassword) {
    tables.Users.push({
      id: formatId("U", 1),
      name: "Admin",
      email: String(adminEmail).trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(adminPassword, 12),
      role: "ADMIN",
      domainId: null,
      coordinatorId: null,
      status: "ACTIVE",
      createdAt: new Date(now).toISOString(),
      mustChangePassword: true,
      ...blankDecision,
      tokenVersion: 0
    });
  }
  return tables;
}

// What a brand-new store starts with, for any driver.
export function initialData({ demo = false, adminEmail, adminPassword } = {}) {
  if (demo) return buildSeed();
  if (!adminEmail || !adminPassword) {
    console.warn("New store created with no accounts: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (or DEMO_MODE=true).");
  }
  return buildBootstrap({ adminEmail, adminPassword });
}

// Past EB tasks per domain, oldest first: [title, days ago the EB deadline was].
const PAST = {
  D001: [
    ["Teaching drive recap video", 52],
    ["Food drive Instagram carousel", 45],
    ["Blood bank awareness flyer", 38],
    ["Open Libraries banner", 31],
    ["Annual report cover", 24],
    ["Health camp volunteer roster", 17],
    ["Navikaran logo refresh", 10]
  ],
  D002: [
    ["Sponsor thank-you emails", 40],
    ["Press note for the food drive", 26],
    ["College fest stall pitch", 12]
  ]
};

/*
 * Per person, per past EB task of their domain: O on time, L late, M missed,
 * - did not pick. Coordinators' marks are their final work for the EB task;
 * volunteers' marks are for the team task their coordinator forwarded.
 * U is on time but not scored yet (waiting in the EB head's queue).
 */
const COORDINATOR_HISTORY = {
  "Ravi Kumar":     "OOOLOOU",
  "Lakshmi Prasad": "OLOMLO-",
  "Arvind Nair":    "OOL"
};

const VOLUNTEER_HISTORY = {
  "Meena Iyer":  "OOLOOOO",
  "Kavya Reddy": "-OOOOOO",
  "Arjun Das":   "OLMLOLO",
  "Sai Teja":    "LMOMLM-",
  "Varun K":     "OMMM---",
  "Divya S":     "-OOLOO-",
  "Harini V":    "--OOLO-",
  "Nikhil P":    "OOO",
  "Ananya K":    "OLM",
  "Rahul V":     "MOO"
};

const TEAM_SCORES = [82, 88, 74, 91, 69, 77, 85, 63, 79, 72];
const EB_SCORES = [84, 79, 88, 72, 90, 81, 76];

export function buildSeed(now = Date.now()) {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const iso = (ms) => new Date(ms).toISOString();
  const created = iso(now - 70 * DAY);

  const Users = PEOPLE.map(([name, email, role, domainId], index) => ({
    id: formatId("U", index + 1),
    name, email, passwordHash, role, domainId,
    coordinatorId: null,
    status: "ACTIVE",
    createdAt: created,
    mustChangePassword: email === DEMO_FIRST_LOGIN_EMAIL,
    ...blankDecision,
    tokenVersion: 0
  }));
  const byEmail = Object.fromEntries(Users.map((user) => [user.email, user]));
  PEOPLE.forEach(([, email, , , coordinatorEmail]) => {
    if (coordinatorEmail) byEmail[email].coordinatorId = byEmail[coordinatorEmail].id;
  });
  const byName = Object.fromEntries(Users.map((user) => [user.name, user]));
  const ebOf = (domainId) => Users.find((u) => u.role === "EB" && u.domainId === domainId);
  const teamOf = (coordinator) => Users.filter((u) => u.coordinatorId === coordinator.id);

  const Tasks = [];
  const Participations = [];
  const Submissions = [];
  const Evaluations = [];
  let teamScore = 0;
  let ebScore = 0;

  const addTask = (task) => {
    const row = {
      id: formatId("T", Tasks.length + 1),
      createdAt: iso(now - 60 * DAY),
      level: "DOMAIN", parentTaskId: null, ownerId: null, reviewNote: null, reviewedBy: null, reviewedAt: null,
      ...task
    };
    Tasks.push(row);
    return row;
  };

  const pick = (task, person, chosenAt) => {
    const participation = { id: formatId("P", Participations.length + 1), taskId: task.id, volunteerId: person.id, chosenAt: iso(chosenAt), status: "SELECTED" };
    Participations.push(participation);
    return participation;
  };

  const submit = (participation, task, person, { at, late = false, slug }) => {
    participation.status = "SUBMITTED";
    const submission = {
      id: formatId("S", Submissions.length + 1),
      participationId: participation.id,
      taskId: task.id,
      volunteerId: person.id,
      kind: "LINK",
      fileId: null, fileUrl: null, fileName: null,
      linkUrl: `https://www.canva.com/design/demo-${slug ?? `${task.id}-${person.id}`.toLowerCase()}`,
      isLate: late,
      submittedAt: iso(at),
      updatedAt: iso(at)
    };
    Submissions.push(submission);
    return submission;
  };

  const score = (participation, submission, evaluator, value, feedback, at) => {
    participation.status = "COMPLETED";
    Evaluations.push({
      id: formatId("E", Evaluations.length + 1),
      submissionId: submission.id,
      evaluatorId: evaluator.id,
      score: value,
      feedback,
      evaluatedAt: iso(at),
      updatedAt: null
    });
  };

  // History: each past EB task, each coordinator's final work, and the team
  // task they forwarded with their volunteers' work.
  for (const [domainId, past] of Object.entries(PAST)) {
    const eb = ebOf(domainId);
    const coordinators = Users.filter((u) => u.role === "COORDINATOR" && u.domainId === domainId && COORDINATOR_HISTORY[u.name]);

    past.forEach(([title, daysAgo], index) => {
      const deadline = now - daysAgo * DAY;
      const parent = addTask({
        title,
        description: `${title} for Street Cause VNRVJIET. Coordinators: deliver one finished piece for the domain.`,
        domainId,
        deadline: iso(deadline),
        // The newest one is past its deadline but not closed yet.
        status: index === past.length - 1 ? "AVAILABLE" : "CLOSED",
        createdBy: eb.id,
        createdAt: iso(deadline - 12 * DAY)
      });

      for (const coordinator of coordinators) {
        const mark = COORDINATOR_HISTORY[coordinator.name][index];
        if (!mark || mark === "-") continue;

        const own = pick(parent, coordinator, deadline - 11 * DAY);
        const teamDeadline = deadline - 2 * DAY;
        const teamTask = addTask({
          title,
          description: `Team brief from ${coordinator.name.split(" ")[0]}: ${title.toLowerCase()}. Send your version before the team deadline so the best ideas go to ${eb.name.split(" ")[0]}.`,
          domainId,
          deadline: iso(teamDeadline),
          status: "CLOSED",
          createdBy: coordinator.id,
          createdAt: iso(deadline - 10 * DAY),
          level: "TEAM",
          parentTaskId: parent.id,
          ownerId: coordinator.id
        });

        for (const volunteer of teamOf(coordinator)) {
          const vmark = VOLUNTEER_HISTORY[volunteer.name]?.[index];
          if (!vmark || vmark === "-") continue;
          const participation = pick(teamTask, volunteer, teamDeadline - 7 * DAY);
          if (vmark === "M") continue;
          const late = vmark === "L";
          const sentAt = late ? teamDeadline + 1.5 * DAY : teamDeadline - 2 * DAY;
          const submission = submit(participation, teamTask, volunteer, { at: sentAt, late });
          score(participation, submission, coordinator,
            TEAM_SCORES[teamScore++ % TEAM_SCORES.length] - (late ? 8 : 0),
            late ? "Good work, but it came in after the deadline." : "Clear and complete. Thank you.",
            sentAt + DAY);
        }

        if (mark === "M") continue;
        const late = mark === "L";
        const sentAt = late ? deadline + DAY : deadline - 0.5 * DAY;
        const final = submit(own, parent, coordinator, { at: sentAt, late });
        if (mark === "U") continue;
        score(own, final, eb,
          EB_SCORES[ebScore++ % EB_SCORES.length] - (late ? 6 : 0),
          late ? "Strong team effort, but the final came in late. Plan the team deadline earlier next time." : "Well put together. Your team's best ideas came through.",
          sentAt + DAY);
      }
    });
  }

  // ---- Current work ----
  const priya = byName["Priya Sharma"];
  const rohan = byName["Rohan Mehta"];
  const ravi = byName["Ravi Kumar"];
  const lakshmi = byName["Lakshmi Prasad"];
  const arvind = byName["Arvind Nair"];

  const poster = addTask({
    title: "Poster for blood donation camp",
    description: "A4 poster for the blood donation camp at VNRVJIET on 25 Oct. Include venue, time and the Street Cause logo.",
    domainId: "D001", deadline: iso(now + 6 * DAY), status: "AVAILABLE", createdBy: priya.id, createdAt: iso(now - 4 * DAY)
  });
  pick(poster, ravi, now - 3.5 * DAY);
  pick(poster, lakshmi, now - 3 * DAY);
  const teamPoster = addTask({
    title: "Poster for blood donation camp",
    description: "Everyone makes a draft A4 poster: venue, time, the Street Cause logo and a clear call to donate. I'll combine the best ideas and send the final to Priya.",
    domainId: "D001", deadline: iso(now + 4 * DAY), status: "AVAILABLE", createdBy: ravi.id, createdAt: iso(now - 3.4 * DAY),
    level: "TEAM", parentTaskId: poster.id, ownerId: ravi.id
  });
  for (const name of ["Meena Iyer", "Kavya Reddy", "Arjun Das"]) pick(teamPoster, byName[name], now - 2 * DAY);
  // Meena and Kavya have already sent their posters, waiting for Ravi's score.
  for (const [name, ago] of [["Meena Iyer", 0.1], ["Kavya Reddy", 0.4]]) {
    const participation = Participations.find((p) => p.taskId === teamPoster.id && p.volunteerId === byName[name].id);
    submit(participation, teamPoster, byName[name], { at: now - ago * DAY, slug: `poster-${byName[name].id.toLowerCase()}` });
  }

  addTask({
    title: "Open Libraries reel script",
    description: "60-second reel script explaining Open Libraries.",
    domainId: "D001", deadline: iso(now + 8 * DAY), status: "DRAFT", createdBy: priya.id, createdAt: iso(now - DAY)
  });
  addTask({
    title: "Donation box survey near campus",
    description: "Visit shops near campus and note which ones will keep a donation box. One list per coordinator, with the shop, the owner's name and a phone number.",
    domainId: "D001", deadline: iso(now + 10 * DAY), status: "AVAILABLE", createdBy: priya.id, createdAt: iso(now - DAY)
  });

  // Ravi's proposal that Priya approved: now a team task, Sai picked it.
  const cards = addTask({
    title: "Thank-you cards for blood donors",
    description: "Hand-lettered thank-you card designs we can print and hand out at the camp. One design each, A6 size.",
    domainId: "D001", deadline: iso(now + 5 * DAY), status: "AVAILABLE", createdBy: ravi.id, createdAt: iso(now - 2.5 * DAY),
    level: "TEAM", ownerId: ravi.id, reviewedBy: priya.id, reviewedAt: iso(now - 2 * DAY), reviewNote: "Lovely idea, go ahead."
  });
  pick(cards, byName["Sai Teja"], now - DAY);

  // One Ravi proposal Priya turned down, and one of Lakshmi's still waiting.
  addTask({
    title: "Redesign the club website",
    description: "Full redesign of the Street Cause VNRVJIET website, with a new home page and event pages.",
    domainId: "D001", deadline: iso(now + 20 * DAY), status: "REJECTED", createdBy: ravi.id, createdAt: iso(now - 6 * DAY),
    level: "TEAM", ownerId: ravi.id, reviewedBy: priya.id, reviewedAt: iso(now - 5 * DAY),
    reviewNote: "Out of scope for this term. Let's plan it with the tech team in January."
  });
  addTask({
    title: "Instagram story templates for Garba Groove",
    description: "Five story templates (countdown, line-up, sponsors, venue, thank-you) in the Garba Groove colours, so PR can post quickly on the day.",
    domainId: "D001", deadline: iso(now + 7 * DAY), status: "PROPOSED", createdBy: lakshmi.id, createdAt: iso(now - 0.6 * DAY),
    level: "TEAM", ownerId: lakshmi.id
  });

  // PR & Marketing: one current EB task, forwarded by Arvind, Nikhil on it.
  const sponsors = addTask({
    title: "Sponsor list for Garba Groove",
    description: "List 25 local businesses to approach for Garba Groove sponsorship, with a contact for each.",
    domainId: "D002", deadline: iso(now + 6 * DAY), status: "AVAILABLE", createdBy: rohan.id, createdAt: iso(now - 2 * DAY)
  });
  pick(sponsors, arvind, now - 1.8 * DAY);
  const teamSponsors = addTask({
    title: "Sponsor list for Garba Groove",
    description: "Ten businesses each, with a contact name and number. I'll merge them for Rohan.",
    domainId: "D002", deadline: iso(now + 4 * DAY), status: "AVAILABLE", createdBy: arvind.id, createdAt: iso(now - 1.7 * DAY),
    level: "TEAM", parentTaskId: sponsors.id, ownerId: arvind.id
  });
  pick(teamSponsors, byName["Nikhil P"], now - DAY);

  // Pooja is new: her account is recent so she shows as NEW, not INACTIVE.
  byName["Pooja M"].createdAt = iso(now - DAY);

  return { Users, Domains: DOMAINS.map((d) => ({ ...d })), Tasks, Participations, Submissions, Evaluations, PushSubscriptions: [], NotificationLog: [] };
}
