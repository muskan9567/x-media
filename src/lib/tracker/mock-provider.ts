import type {
  PostMedia,
  ProviderAccount,
  ProviderTweet,
  XDataProvider,
} from "./types";

interface MockProfile {
  name: string;
  bio: string;
  followers: number;
  following: number;
  tweets: number;
  verified?: boolean;
  posts: string[];
}

const MOCK_PROFILES: Record<string, MockProfile> = {
  buildwithmaya: {
    name: "Maya Chen",
    bio: "Building practical AI agents, devtools, and tiny software products in public.",
    followers: 38_420,
    following: 812,
    tweets: 9_210,
    verified: true,
    posts: [
      "AI agents do not need more tools. They need better stopping rules. Here is the framework we use after shipping 14 production workflows.",
      "I replaced a 900-line automation with three small TypeScript functions. Reliability went up, not down.",
      "The underrated startup advantage: instrument the boring workflow before trying to automate it.",
      "Open source is distribution when the software teaches people how you think.",
    ],
  },
  growthnotes: {
    name: "Noah Williams",
    bio: "Growth systems for bootstrapped SaaS. Clear experiments, honest numbers, no hacks.",
    followers: 21_680,
    following: 634,
    tweets: 6_402,
    posts: [
      "We studied 112 SaaS launches. The winners did not post more—they repeated one sharp problem in five useful formats.",
      "A landing page is not a brochure. It is a sequence of answered objections.",
      "What growth experiment would you run if you had to learn something useful in 48 hours?",
      "Our best newsletter conversion came from deleting half the form and adding one concrete example.",
    ],
  },
  designshift: {
    name: "Ari Okafor",
    bio: "Product designer. Design systems, UX research, and interfaces that stay out of the way.",
    followers: 16_930,
    following: 1_124,
    tweets: 4_982,
    posts: [
      "A dashboard should answer: what changed, why it matters, and what to do next. Everything else is supporting detail.",
      "The best design-system token is the one that removes a future argument.",
      "We tested five onboarding flows. The calmest one—with one decision per screen—won by 31%.",
      "Tiny UX fix: put the consequence inside the button label instead of explaining it three lines above.",
    ],
  },
  founderbrief: {
    name: "Sam Rivera",
    bio: "Bootstrapped founder sharing SaaS lessons, revenue experiments, and product decisions.",
    followers: 52_105,
    following: 952,
    tweets: 12_331,
    verified: true,
    posts: [
      "It took us 18 months to reach $10k MRR and 11 weeks to reach $20k. Compounding looks like nothing—until it does not.",
      "The customer who churned gave us a better roadmap than the ten who said everything was fine.",
      "Founders: what did you stop doing that unlocked more growth?",
      "Product-market fit feels less like celebration and more like your calendar suddenly belonging to customers.",
    ],
  },
  aifieldnotes: {
    name: "Leila Park",
    bio: "Field notes on AI products, model evaluation, automation, and the future of knowledge work.",
    followers: 73_880,
    following: 1_870,
    tweets: 15_204,
    verified: true,
    posts: [
      "Most AI evals measure whether a model can answer. Production evals must measure whether the whole system knows when not to.",
      "The next wave of AI products will win on context quality, not model access.",
      "I compared seven agent memory patterns. The simplest retrieval-first setup beat the clever architectures on cost and trust.",
      "Automation without an audit trail is just faster uncertainty.",
    ],
  },
};

function hash(input: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return Math.abs(value >>> 0);
}

function titleCaseHandle(username: string): string {
  return username
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function genericProfile(username: string): MockProfile {
  const seed = hash(username);
  return {
    name: titleCaseHandle(username),
    bio: "Creator sharing practical notes on technology, products, growth, and modern work.",
    followers: 3_000 + (seed % 84_000),
    following: 180 + (seed % 1_900),
    tweets: 900 + (seed % 18_000),
    posts: [
      "The fastest way to improve a product is to watch where users hesitate, then remove one decision.",
      "A useful growth system turns every launch into an answer, not just an announcement.",
      "What is one workflow you would automate only after understanding it manually?",
      "Small software teams win by making the feedback loop visible to everyone.",
    ],
  };
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

function mockMedia(username: string, postIndex: number): PostMedia[] {
  const photo = (suffix: string, width = 1200, height = 800): PostMedia => ({
    mediaKey: `mock-photo-${username}-${postIndex}-${suffix}`,
    type: "photo",
    url: `https://picsum.photos/seed/${encodeURIComponent(`${username}-${postIndex}-${suffix}`)}/${width}/${height}`,
    altText: `Demo editorial image for @${username}`,
    width,
    height,
    variants: [],
  });

  if (postIndex === 0) {
    return [
      photo("a", 1200, 900),
      photo("b", 900, 1200),
      photo("c", 1200, 900),
      photo("d", 1200, 900),
    ];
  }

  if (postIndex === 1) {
    return [
      {
        mediaKey: `mock-video-${username}-${postIndex}`,
        type: "video",
        previewImageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${username}-video`)}/1280/720`,
        altText: `Demo product video for @${username}`,
        width: 1280,
        height: 720,
        durationMs: 30_000,
        variants: [
          {
            url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
            contentType: "video/mp4",
            bitRate: 1_000_000,
          },
        ],
      },
    ];
  }

  if (postIndex === 2) {
    return [
      {
        mediaKey: `mock-gif-${username}-${postIndex}`,
        type: "animated_gif",
        previewImageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${username}-gif`)}/960/720`,
        altText: `Demo looping animation for @${username}`,
        width: 960,
        height: 720,
        variants: [
          {
            url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
            contentType: "video/mp4",
          },
        ],
      },
    ];
  }

  return [];
}

export class MockXProvider implements XDataProvider {
  readonly mode = "mock" as const;

  constructor(private readonly currentTime = () => Date.now()) {}

  async resolveAccount(usernameInput: string): Promise<ProviderAccount> {
    const username = normalizeUsername(usernameInput);
    const profile = MOCK_PROFILES[username] ?? genericProfile(username);

    return {
      source: "mock",
      xUserId: `mock-user-${username}`,
      username,
      displayName: profile.name,
      bio: profile.bio,
      profileImageUrl: `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(username)}`,
      followersCount: profile.followers,
      followingCount: profile.following,
      tweetCount: profile.tweets,
      verified: profile.verified ?? false,
    };
  }

  async refreshAccount(account: ProviderAccount): Promise<ProviderAccount> {
    const refreshed = await this.resolveAccount(account.username);
    return { ...refreshed, xUserId: account.xUserId };
  }

  async fetchRecentTweets(account: ProviderAccount): Promise<ProviderTweet[]> {
    const profile = MOCK_PROFILES[account.username] ?? genericProfile(account.username);
    const now = this.currentTime();
    const currentDate = new Date(now);
    const batchStartedAt = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
    );
    const dayKey = new Date(batchStartedAt)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "");
    const ages = [1.1, 5.4, 17.5, 54];
    const multipliers = [1.8, 0.82, 1.18, 0.48];
    const dayProgress = (now - batchStartedAt) / (24 * 60 * 60 * 1_000);

    return profile.posts.map((text, index) => {
      const seed = hash(`${account.username}-${index}`);
      const audienceScale = Math.max(0.8, Math.sqrt(account.followersCount / 8_000));
      const base =
        (90 + (seed % 760)) *
        multipliers[index % multipliers.length] *
        audienceScale *
        (index === 0 ? 1 + dayProgress * 0.2 : 1);
      const likes = Math.round(base);
      const reposts = Math.round(base * (0.12 + (seed % 9) / 100));
      const replies = Math.round(base * (0.045 + (seed % 6) / 100));
      const quotes = Math.round(base * (0.018 + (seed % 4) / 100));
      const bookmarks = Math.round(base * (0.07 + (seed % 8) / 100));

      return {
        source: "mock",
        id: `mock-${hash(`${account.username}-${dayKey}-${index}`)}`,
        text,
        createdAt: new Date(
          batchStartedAt - ages[index] * 60 * 60 * 1_000,
        ).toISOString(),
        language: "en",
        conversationId: `mock-conversation-${hash(`${account.username}-${index}`)}`,
        possiblySensitive: false,
        replySettings: "everyone",
        media: mockMedia(account.username, index),
        metrics: {
          likeCount: likes,
          repostCount: reposts,
          replyCount: replies,
          quoteCount: quotes,
          bookmarkCount: bookmarks,
          viewCount: Math.round(likes * (18 + (seed % 21))),
        },
      };
    });
  }
}

export const DEMO_HANDLES = Object.keys(MOCK_PROFILES);
