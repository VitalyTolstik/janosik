import type { LabelColor } from "./types/kanban";
import type { BoardStarterLocale } from "./board-starter";

/**
 * TASK-177.16 (follow-up): the first-run example catalog.
 *
 * One source of truth for the gallery, the live preview, the server command
 * generator and the offline reducer. Everything here is static copy and
 * structure — no database rows, no new endpoint. The legacy `starter` alias
 * stays in `board-starter.ts` for old clients and their tests.
 */

export const BOARD_TEMPLATE_IDS = [
  "product-launch",
  "sprint",
  "personal",
  "content-calendar",
  "hiring",
  "bug-tracker",
] as const;

export type BoardTemplateId = (typeof BOARD_TEMPLATE_IDS)[number];

/** What `POST /boards` accepts: a curated example or the legacy starter. */
export type BoardTemplateSelection = BoardTemplateId | "starter";

export const BOARD_TEMPLATE_ICONS = [
  "rocket",
  "layers",
  "sun",
  "calendar",
  "users",
  "bug",
] as const;

export type BoardTemplateIcon = (typeof BOARD_TEMPLATE_ICONS)[number];

export const BOARD_TEMPLATE_ACCENTS = [
  "blue",
  "amber",
  "teal",
  "pink",
  "indigo",
  "red",
] as const;

export type BoardTemplateAccent = (typeof BOARD_TEMPLATE_ACCENTS)[number];

export type BoardTemplateNaming = "day" | "iso-week" | "month" | "none";

export interface BoardTemplateCardCopy {
  title: string;
  /** Label keys from the locale's `labels` record. */
  labels: readonly string[];
  /** Days from the creation day (0 = today). */
  dueInDays?: number;
  desc?: string;
  checklist?: {
    title: string;
    items: readonly string[];
  };
}

export interface BoardTemplateColumnCopy {
  title: string;
  cards: readonly BoardTemplateCardCopy[];
}

export interface BoardTemplateCopy {
  name: string;
  short: string;
  long: string;
  tags: readonly string[];
  labels: Readonly<Record<string, string>>;
  columns: readonly BoardTemplateColumnCopy[];
}

export interface BoardTemplate {
  id: BoardTemplateId;
  icon: BoardTemplateIcon;
  accent: BoardTemplateAccent;
  naming: BoardTemplateNaming;
  copy: Record<BoardStarterLocale, BoardTemplateCopy>;
}

/**
 * Label colours follow the prototype: the order of the locale's `labels`
 * record maps onto this stable cycle, so EN and RU agree and the mockup's
 * blue → red sequence is preserved without a per-template colour table.
 */
export const BOARD_TEMPLATE_LABEL_COLORS = [
  "blue",
  "indigo",
  "teal",
  "pink",
  "orange",
  "green",
  "red",
  "slate",
  "yellow",
] as const satisfies readonly LabelColor[];

export function boardTemplateLabelColor(
  template: BoardTemplate,
  labelKey: string,
): LabelColor {
  const keys = Object.keys(template.copy.en.labels);
  const index = keys.indexOf(labelKey);
  return BOARD_TEMPLATE_LABEL_COLORS[
    (index < 0 ? 0 : index) % BOARD_TEMPLATE_LABEL_COLORS.length
  ]!;
}

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: "product-launch",
    icon: "rocket",
    accent: "blue",
    naming: "day",
    copy: {
      en: {
        name: "Product launch",
        short: "From brief to launch day, with a clear owner for every step.",
        long: "A four-stage launch plan for a small team: shape the brief, build the story, prepare the release, and learn from the first week. Every card is ordinary content you can rename, move, or delete.",
        tags: ["Marketing", "Product", "Release"],
        labels: {
          strategy: "Strategy",
          decision: "Decision",
          web: "Web",
          video: "Video",
          email: "Email",
          enablement: "Enablement",
          research: "Research",
        },
        columns: [
          {
            title: "Strategy",
            cards: [
              {
                title: "Write the launch brief",
                labels: ["strategy", "decision"],
                dueInDays: 2,
                desc: "Goal, audience, one-line promise, and the metric that proves the launch worked.",
                checklist: {
                  title: "Brief checklist",
                  items: ["Goal", "Audience", "Promise", "Success metric"],
                },
              },
              {
                title: "Agree the launch tier",
                labels: ["decision"],
                dueInDays: 4,
                desc: "Tier 1 gets a full campaign; tier 2 gets a changelog and a short demo.",
              },
            ],
          },
          {
            title: "Build",
            cards: [
              {
                title: "Finalize the landing page",
                labels: ["web"],
                dueInDays: 8,
                checklist: {
                  title: "Page checklist",
                  items: ["Copy", "Hero image", "Mobile QA"],
                },
              },
              {
                title: "Record the 90-second demo",
                labels: ["video"],
                dueInDays: 9,
              },
            ],
          },
          {
            title: "Launch prep",
            cards: [
              {
                title: "Schedule announcement emails",
                labels: ["email"],
                dueInDays: 11,
                checklist: {
                  title: "Before send",
                  items: ["Segments", "Test links", "Send time"],
                },
              },
              {
                title: "Brief support and sales",
                labels: ["enablement"],
                dueInDays: 10,
              },
            ],
          },
          {
            title: "Shipped",
            cards: [
              {
                title: "Collect first-week feedback",
                labels: ["research"],
                dueInDays: 18,
              },
            ],
          },
        ],
      },
      ru: {
        name: "Запуск продукта",
        short:
          "От брифа до дня запуска — с понятным ответственным на каждом шаге.",
        long: "Четырёхэтапный план запуска для небольшой команды: собрать бриф, подготовить историю, провести релиз и разобрать первую неделю. Каждая карточка — обычный контент, который можно переименовать, переместить или удалить.",
        tags: ["Маркетинг", "Продукт", "Релиз"],
        labels: {
          strategy: "Стратегия",
          decision: "Решение",
          web: "Сайт",
          video: "Видео",
          email: "Письма",
          enablement: "Команда",
          research: "Исследование",
        },
        columns: [
          {
            title: "Стратегия",
            cards: [
              {
                title: "Написать бриф запуска",
                labels: ["strategy", "decision"],
                dueInDays: 2,
                desc: "Цель, аудитория, обещание в одну строку и метрика, которая докажет успех запуска.",
                checklist: {
                  title: "Чек-лист брифа",
                  items: ["Цель", "Аудитория", "Обещание", "Метрика успеха"],
                },
              },
              {
                title: "Согласовать уровень запуска",
                labels: ["decision"],
                dueInDays: 4,
                desc: "Первый уровень — полная кампания; второй — changelog и короткое демо.",
              },
            ],
          },
          {
            title: "Подготовка",
            cards: [
              {
                title: "Финализировать лендинг",
                labels: ["web"],
                dueInDays: 8,
                checklist: {
                  title: "Чек-лист страницы",
                  items: ["Текст", "Главный экран", "Мобильная проверка"],
                },
              },
              {
                title: "Записать демо на 90 секунд",
                labels: ["video"],
                dueInDays: 9,
              },
            ],
          },
          {
            title: "Перед запуском",
            cards: [
              {
                title: "Запланировать письма анонса",
                labels: ["email"],
                dueInDays: 11,
                checklist: {
                  title: "Перед отправкой",
                  items: ["Сегменты", "Проверить ссылки", "Время отправки"],
                },
              },
              {
                title: "Проинструктировать поддержку и продажи",
                labels: ["enablement"],
                dueInDays: 10,
              },
            ],
          },
          {
            title: "Выпущено",
            cards: [
              {
                title: "Собрать обратную связь за первую неделю",
                labels: ["research"],
                dueInDays: 18,
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "sprint",
    icon: "layers",
    accent: "amber",
    naming: "iso-week",
    copy: {
      en: {
        name: "Sprint board",
        short:
          "A one-sprint board from backlog to done, with a sample definition of done.",
        long: "A lightweight scrum board for one sprint: a short backlog, work in progress, review, and done. Use the sample cards to agree on what “done” means before the sprint starts.",
        tags: ["Engineering", "Agile"],
        labels: {
          ux: "UX",
          backend: "Backend",
          feature: "Feature",
          bug: "Bug",
          content: "Content",
          infra: "Infra",
        },
        columns: [
          {
            title: "Backlog",
            cards: [
              {
                title: "Refine checkout error states",
                labels: ["ux"],
                dueInDays: 5,
                desc: "Make every failure state say what happened, what to do next, and whether money moved.",
                checklist: {
                  title: "Ready criteria",
                  items: ["Error copy", "Edge cases", "Design review"],
                },
              },
              {
                title: "Add rate limit to public API",
                labels: ["backend"],
                dueInDays: 7,
              },
            ],
          },
          {
            title: "In progress",
            cards: [
              {
                title: "Ship saved views",
                labels: ["feature"],
                dueInDays: 4,
                desc: "Saved views are the first workflow that makes a board feel like a tool, not a list.",
                checklist: {
                  title: "Definition of done",
                  items: [
                    "Tests",
                    "Empty state",
                    "Keyboard",
                    "Docs",
                    "Feature flag",
                  ],
                },
              },
              {
                title: "Fix mobile drag ghost",
                labels: ["bug"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Review",
            cards: [
              {
                title: "Update onboarding copy",
                labels: ["content"],
                dueInDays: 1,
                checklist: {
                  title: "Review",
                  items: ["Tone", "RU parity", "Screenshots"],
                },
              },
            ],
          },
          {
            title: "Done",
            cards: [
              {
                title: "Set up error tracking",
                labels: ["infra"],
                dueInDays: 6,
              },
            ],
          },
        ],
      },
      ru: {
        name: "Спринт",
        short:
          "Доска одного спринта: от бэклога до готово, с примером definition of done.",
        long: "Лёгкая scrum-доска на один спринт: короткий бэклог, работа в процессе, ревью и готово. Примеры карточек помогают договориться, что считается «сделано», до старта спринта.",
        tags: ["Разработка", "Agile"],
        labels: {
          ux: "UX",
          backend: "Бэкенд",
          feature: "Фича",
          bug: "Баг",
          content: "Контент",
          infra: "Инфра",
        },
        columns: [
          {
            title: "Бэклог",
            cards: [
              {
                title: "Уточнить состояния ошибок checkout",
                labels: ["ux"],
                dueInDays: 5,
                desc: "Каждое состояние ошибки должно объяснять, что случилось, что делать дальше и прошли ли деньги.",
                checklist: {
                  title: "Критерии готовности",
                  items: ["Текст ошибок", "Крайние случаи", "Дизайн-ревью"],
                },
              },
              {
                title: "Добавить rate limit в публичный API",
                labels: ["backend"],
                dueInDays: 7,
              },
            ],
          },
          {
            title: "В работе",
            cards: [
              {
                title: "Выпустить сохранённые виды",
                labels: ["feature"],
                dueInDays: 4,
                desc: "Сохранённые виды — первый сценарий, после которого доска ощущается инструментом, а не списком.",
                checklist: {
                  title: "Definition of done",
                  items: [
                    "Тесты",
                    "Пустое состояние",
                    "Клавиатура",
                    "Документация",
                    "Флаг",
                  ],
                },
              },
              {
                title: "Починить drag ghost на мобиле",
                labels: ["bug"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Ревью",
            cards: [
              {
                title: "Обновить тексты онбординга",
                labels: ["content"],
                dueInDays: 1,
                checklist: {
                  title: "Ревью",
                  items: ["Тон", "Паритет RU", "Скриншоты"],
                },
              },
            ],
          },
          {
            title: "Готово",
            cards: [
              {
                title: "Настроить трекинг ошибок",
                labels: ["infra"],
                dueInDays: 6,
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "personal",
    icon: "sun",
    accent: "teal",
    naming: "none",
    copy: {
      en: {
        name: "Personal tasks",
        short:
          "A calm three-column board for focus work, errands, and the things you postpone.",
        long: "A calm, three-lane board for the week ahead. It keeps focus work, errands, and someday ideas separate without turning your personal life into a sprint.",
        tags: ["Personal", "GTD"],
        labels: {
          focus: "Focus",
          errand: "Errand",
          health: "Health",
          home: "Home",
          later: "Later",
        },
        columns: [
          {
            title: "Today",
            cards: [
              {
                title: "Plan the week",
                labels: ["focus"],
                dueInDays: 0,
                desc: "Three outcomes, not thirty. Leave one block empty for the thing that always appears.",
                checklist: {
                  title: "Weekly reset",
                  items: ["Top 3 outcomes", "Calendar", "Errands", "Buffer"],
                },
              },
              {
                title: "Book dentist appointment",
                labels: ["health"],
                dueInDays: 2,
              },
              {
                title: "Renew passport",
                labels: ["errand"],
                dueInDays: 10,
              },
            ],
          },
          {
            title: "This week",
            cards: [
              {
                title: "Deep clean the desk",
                labels: ["home"],
                dueInDays: 4,
              },
              {
                title: "Draft tax documents",
                labels: ["focus"],
                dueInDays: 20,
                desc: "Collect the four documents first, then fill the form in one sitting. The first step is the blocker.",
              },
            ],
          },
          {
            title: "Someday",
            cards: [
              {
                title: "Learn basic bread baking",
                labels: ["later"],
              },
              {
                title: "Sort the photo archive",
                labels: ["home"],
                desc: "One folder per year is enough for the first pass; do not rename every file.",
              },
            ],
          },
        ],
      },
      ru: {
        name: "Личные задачи",
        short:
          "Спокойная доска из трёх колонок для фокуса, дел и всего, что откладывается.",
        long: "Спокойная доска на три колонки для недели вперёд. Фокусная работа, бытовые дела и идеи «когда-нибудь» не смешиваются, а личная жизнь не превращается в спринт.",
        tags: ["Личное", "GTD"],
        labels: {
          focus: "Фокус",
          errand: "Дело",
          health: "Здоровье",
          home: "Дом",
          later: "Потом",
        },
        columns: [
          {
            title: "Сегодня",
            cards: [
              {
                title: "Спланировать неделю",
                labels: ["focus"],
                dueInDays: 0,
                desc: "Три результата, а не тридцать. Оставьте один блок пустым для того, что всегда появляется.",
                checklist: {
                  title: "Недельный сброс",
                  items: ["Три результата", "Календарь", "Дела", "Буфер"],
                },
              },
              {
                title: "Записаться к стоматологу",
                labels: ["health"],
                dueInDays: 2,
              },
              {
                title: "Продлить паспорт",
                labels: ["errand"],
                dueInDays: 10,
              },
            ],
          },
          {
            title: "На этой неделе",
            cards: [
              {
                title: "Разобрать рабочий стол",
                labels: ["home"],
                dueInDays: 4,
              },
              {
                title: "Подготовить документы для налогов",
                labels: ["focus"],
                dueInDays: 20,
                desc: "Сначала соберите четыре документа, потом заполните форму за один подход. Первый шаг и есть блокер.",
              },
            ],
          },
          {
            title: "Когда-нибудь",
            cards: [
              {
                title: "Научиться печь хлеб",
                labels: ["later"],
              },
              {
                title: "Разобрать фотоархив",
                labels: ["home"],
                desc: "Для первого прохода достаточно одной папки на год; не переименовывайте каждый файл.",
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "content-calendar",
    icon: "calendar",
    accent: "pink",
    naming: "month",
    copy: {
      en: {
        name: "Content calendar",
        short:
          "Move every idea from draft to published without losing the brief.",
        long: "An editorial pipeline from idea to published. The sample brief and review checklist keep the useful parts of the process, not the ceremony.",
        tags: ["Marketing", "Editorial"],
        labels: {
          blog: "Blog",
          social: "Social",
          newsletter: "Newsletter",
          video: "Video",
          seo: "SEO",
        },
        columns: [
          {
            title: "Ideas",
            cards: [
              {
                title: "Q1 customer story shortlist",
                labels: ["blog"],
                dueInDays: 3,
                desc: "Pick three customers with a measurable before/after; the story writes itself once the numbers are real.",
              },
              {
                title: "Holiday gift guide angle",
                labels: ["social"],
                dueInDays: 5,
              },
            ],
          },
          {
            title: "Drafting",
            cards: [
              {
                title: "Write the launch post",
                labels: ["blog"],
                dueInDays: 7,
                checklist: {
                  title: "Post checklist",
                  items: ["Outline", "Draft", "Proofread", "Images", "Publish"],
                },
              },
              {
                title: "Cut the demo into three shorts",
                labels: ["video"],
                dueInDays: 6,
              },
            ],
          },
          {
            title: "Review",
            cards: [
              {
                title: "Review the November newsletter",
                labels: ["newsletter"],
                dueInDays: 2,
                checklist: {
                  title: "Review checklist",
                  items: ["Links", "Legal", "Subject lines"],
                },
              },
              {
                title: "Add schema to pricing page",
                labels: ["seo"],
                dueInDays: 9,
              },
            ],
          },
          {
            title: "Published",
            cards: [
              {
                title: "Publish the changelog",
                labels: ["blog"],
                dueInDays: 1,
              },
            ],
          },
        ],
      },
      ru: {
        name: "Контент-план",
        short: "Ведите каждую идею от черновика до публикации, не теряя бриф.",
        long: "Редакционный конвейер от идеи до публикации. Пример брифа и чек-лист ревью сохраняют полезную часть процесса, а не бюрократию.",
        tags: ["Маркетинг", "Редакция"],
        labels: {
          blog: "Блог",
          social: "Соцсети",
          newsletter: "Рассылка",
          video: "Видео",
          seo: "SEO",
        },
        columns: [
          {
            title: "Идеи",
            cards: [
              {
                title: "Шорт-лист клиентских историй на Q1",
                labels: ["blog"],
                dueInDays: 3,
                desc: "Выберите трёх клиентов с измеримым «до/после»; история пишется сама, когда цифры настоящие.",
              },
              {
                title: "Угол для праздничного гайда",
                labels: ["social"],
                dueInDays: 5,
              },
            ],
          },
          {
            title: "Черновики",
            cards: [
              {
                title: "Написать пост о запуске",
                labels: ["blog"],
                dueInDays: 7,
                checklist: {
                  title: "Чек-лист поста",
                  items: [
                    "План",
                    "Черновик",
                    "Вычитка",
                    "Картинки",
                    "Публикация",
                  ],
                },
              },
              {
                title: "Нарезать демо на три шортса",
                labels: ["video"],
                dueInDays: 6,
              },
            ],
          },
          {
            title: "Ревью",
            cards: [
              {
                title: "Проверить ноябрьскую рассылку",
                labels: ["newsletter"],
                dueInDays: 2,
                checklist: {
                  title: "Чек-лист ревью",
                  items: ["Ссылки", "Юридические", "Темы писем"],
                },
              },
              {
                title: "Добавить schema на страницу тарифов",
                labels: ["seo"],
                dueInDays: 9,
              },
            ],
          },
          {
            title: "Опубликовано",
            cards: [
              {
                title: "Опубликовать changelog",
                labels: ["blog"],
                dueInDays: 1,
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "hiring",
    icon: "users",
    accent: "indigo",
    naming: "month",
    copy: {
      en: {
        name: "Hiring pipeline",
        short: "Keep candidates moving from first touch to a signed offer.",
        long: "A four-stage hiring board that keeps candidates moving and makes the handoff from interview to offer explicit. Swap the sample role for the one you are hiring.",
        tags: ["People", "Hiring"],
        labels: {
          design: "Design",
          engineering: "Engineering",
          referral: "Referral",
          urgent: "Urgent",
          onsite: "Onsite",
        },
        columns: [
          {
            title: "Sourced",
            cards: [
              {
                title: "Source senior product designers",
                labels: ["design"],
                dueInDays: 5,
              },
              {
                title: "Referral: backend engineer",
                labels: ["engineering", "referral"],
                dueInDays: 3,
              },
            ],
          },
          {
            title: "Screening",
            cards: [
              {
                title: "Screen Maria for platform role",
                labels: ["engineering"],
                dueInDays: 2,
                desc: "Focus the call on ownership of production systems, not trivia. Ask for one incident they ran end to end.",
              },
              {
                title: "Review take-home: Payment API",
                labels: ["engineering", "urgent"],
                dueInDays: 1,
              },
            ],
          },
          {
            title: "Interview",
            cards: [
              {
                title: "Schedule onsite loop",
                labels: ["design", "onsite"],
                dueInDays: 4,
                checklist: {
                  title: "Loop checklist",
                  items: ["Panel", "Calendar", "Brief", "Candidate"],
                },
              },
              {
                title: "Debrief: staff engineer panel",
                labels: ["engineering"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Offer",
            cards: [
              {
                title: "Prepare offer approval",
                labels: ["urgent"],
                dueInDays: 6,
                desc: "Align level and compensation before the final call; the candidate should hear one consistent story.",
                checklist: {
                  title: "Offer checklist",
                  items: ["Compensation", "Level", "Approvals"],
                },
              },
            ],
          },
        ],
      },
      ru: {
        name: "Найм",
        short:
          "Держите кандидатов в движении от первого контакта до подписанного оффера.",
        long: "Доска найма на четыре этапа, которая помогает не терять кандидатов и делает передачу от интервью к офферу явной. Замените пример роли на ту, которую закрываете.",
        tags: ["Люди", "Найм"],
        labels: {
          design: "Дизайн",
          engineering: "Инженерия",
          referral: "Рекомендация",
          urgent: "Срочно",
          onsite: "Онсайт",
        },
        columns: [
          {
            title: "Поиск",
            cards: [
              {
                title: "Найти senior product designer",
                labels: ["design"],
                dueInDays: 5,
              },
              {
                title: "Рекомендация: backend-инженер",
                labels: ["engineering", "referral"],
                dueInDays: 3,
              },
            ],
          },
          {
            title: "Скрининг",
            cards: [
              {
                title: "Скрининг Марии на платформенную роль",
                labels: ["engineering"],
                dueInDays: 2,
                desc: "Сфокусируйте звонок на ответственности за продакшн-системы, а не на trivia. Попросите один инцидент, который человек провёл целиком.",
              },
              {
                title: "Проверить тестовое: Payment API",
                labels: ["engineering", "urgent"],
                dueInDays: 1,
              },
            ],
          },
          {
            title: "Интервью",
            cards: [
              {
                title: "Назначить онсайт-цикл",
                labels: ["design", "onsite"],
                dueInDays: 4,
                checklist: {
                  title: "Чек-лист цикла",
                  items: ["Панель", "Календарь", "Бриф", "Кандидат"],
                },
              },
              {
                title: "Дебриф: панель staff-инженера",
                labels: ["engineering"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Оффер",
            cards: [
              {
                title: "Подготовить согласование оффера",
                labels: ["urgent"],
                dueInDays: 6,
                desc: "Согласуйте уровень и компенсацию до финального звонка; кандидат должен услышать одну непротиворечивую историю.",
                checklist: {
                  title: "Чек-лист оффера",
                  items: ["Компенсация", "Уровень", "Согласования"],
                },
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "bug-tracker",
    icon: "bug",
    accent: "red",
    naming: "none",
    copy: {
      en: {
        name: "Bug tracker",
        short:
          "Triage what broke, prove the fix, and close the loop with users.",
        long: "A four-stage bug board from triage to verified. The sample reproduction checklist makes “fixed” mean verified, not just merged.",
        tags: ["Engineering", "Support"],
        labels: {
          crash: "Crash",
          ui: "UI",
          api: "API",
          p1: "P1",
          regression: "Regression",
        },
        columns: [
          {
            title: "Triage",
            cards: [
              {
                title: "Checkout crashes on iOS 18",
                labels: ["crash", "p1"],
                dueInDays: 0,
                desc: "Crash on the payment step, reproducible on iOS 18.2. Capture the device log before touching the code.",
                checklist: {
                  title: "Reproduction",
                  items: ["Steps", "Device", "Logs", "Owner"],
                },
              },
              {
                title: "Tooltip overlaps avatar menu",
                labels: ["ui"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Confirmed",
            cards: [
              {
                title: "Webhook retries duplicate events",
                labels: ["api", "regression"],
                dueInDays: 3,
                desc: "A retry after a 504 delivers the same event twice. Confirm the idempotency key survives the gateway.",
              },
              {
                title: "Search misses archived cards",
                labels: ["api"],
                dueInDays: 5,
              },
            ],
          },
          {
            title: "Fixing",
            cards: [
              {
                title: "Fix duplicate webhook delivery",
                labels: ["api", "p1"],
                dueInDays: 2,
              },
              {
                title: "Align empty-state icon on mobile",
                labels: ["ui"],
                dueInDays: 4,
              },
            ],
          },
          {
            title: "Verified",
            cards: [
              {
                title: "Verify the fix on staging",
                labels: ["regression"],
                dueInDays: 6,
                checklist: {
                  title: "Verification",
                  items: ["Repro", "Regression", "Sign-off"],
                },
              },
            ],
          },
        ],
      },
      ru: {
        name: "Баги",
        short:
          "Разберите поломку, докажите исправление и закройте цикл с пользователями.",
        long: "Доска багов на четыре этапа: от триажа до подтверждения. Пример чек-листа воспроизведения делает «исправлено» проверенным, а не просто смерженным.",
        tags: ["Разработка", "Поддержка"],
        labels: {
          crash: "Краш",
          ui: "UI",
          api: "API",
          p1: "P1",
          regression: "Регрессия",
        },
        columns: [
          {
            title: "Триаж",
            cards: [
              {
                title: "Checkout падает на iOS 18",
                labels: ["crash", "p1"],
                dueInDays: 0,
                desc: "Падение на шаге оплаты, воспроизводится на iOS 18.2. Снимите лог устройства до того, как трогать код.",
                checklist: {
                  title: "Воспроизведение",
                  items: ["Шаги", "Устройство", "Логи", "Ответственный"],
                },
              },
              {
                title: "Тултип перекрывает меню аватара",
                labels: ["ui"],
                dueInDays: 2,
              },
            ],
          },
          {
            title: "Подтверждено",
            cards: [
              {
                title: "Вебхуки дублируют события при ретрае",
                labels: ["api", "regression"],
                dueInDays: 3,
                desc: "После 504 ретрай доставляет событие дважды. Проверьте, что idempotency key переживает шлюз.",
              },
              {
                title: "Поиск не находит архивные карточки",
                labels: ["api"],
                dueInDays: 5,
              },
            ],
          },
          {
            title: "В работе",
            cards: [
              {
                title: "Исправить дубли вебхуков",
                labels: ["api", "p1"],
                dueInDays: 2,
              },
              {
                title: "Выровнять иконку пустого состояния на мобиле",
                labels: ["ui"],
                dueInDays: 4,
              },
            ],
          },
          {
            title: "Проверено",
            cards: [
              {
                title: "Проверить фикс на стейджинге",
                labels: ["regression"],
                dueInDays: 6,
                checklist: {
                  title: "Проверка",
                  items: ["Воспроизведение", "Регрессия", "Подпись"],
                },
              },
            ],
          },
        ],
      },
    },
  },
] as const;

export function boardTemplateById(
  id: BoardTemplateId,
): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((template) => template.id === id);
}

export function isBoardTemplateId(value: unknown): value is BoardTemplateId {
  return (
    typeof value === "string" &&
    (BOARD_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export function isBoardCreateTemplate(
  value: unknown,
): value is BoardTemplateSelection {
  return value === "starter" || isBoardTemplateId(value);
}

export interface BoardTemplateCounts {
  columns: number;
  cards: number;
  labels: number;
  checklists: number;
  items: number;
}

export function boardTemplateCounts(
  template: BoardTemplate,
): BoardTemplateCounts {
  const copy = template.copy.en;
  let cards = 0;
  let checklists = 0;
  let items = 0;
  for (const column of copy.columns) {
    cards += column.cards.length;
    for (const card of column.cards) {
      if (card.checklist) {
        checklists += 1;
        items += card.checklist.items.length;
      }
    }
  }
  return {
    columns: copy.columns.length,
    cards,
    labels: Object.keys(copy.labels).length,
    checklists,
    items,
  };
}

/** A locale the UI and the server both understand for template content. */
export type BoardTemplateLocale = BoardStarterLocale;
