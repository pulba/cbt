import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// cbt_user_grup
export const userGroups = sqliteTable('user_groups', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(), // grup_nama
    description: text('description'),
});

// cbt_user (Students)
export const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id').references(() => userGroups.id),
    username: text('username').notNull().unique(), // No Peserta / Username
    password: text('password').notNull(),
    firstName: text('first_name').notNull(),
    email: text('email'),
    detail: text('detail'),
    isLogin: integer('is_login', { mode: 'boolean' }).default(false),
});

// Admin Users (cbt_users for backend)
export const admins = sqliteTable('admins', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull().unique(),
    password: text('password').notNull(),
    level: text('level').notNull(), // admin, guru
});

// Topik
export const topics = sqliteTable('topics', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    description: text('description'),
    status: integer('status', { mode: 'boolean' }).default(true),
});

// Bank Soal
export const questions = sqliteTable('questions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    topicId: integer('topic_id').references(() => topics.id),
    type: integer('type').notNull(), // 1: PG, 2: Essay, 3: Short
    text: text('text').notNull(), // HTML content
    audio: text('audio'),
    audioPlayLimit: integer('audio_play_limit').default(0),
    difficulty: integer('difficulty').default(1),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
});

// Pilihan Jawaban (untuk PG)
export const questionAnswers = sqliteTable('question_answers', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    questionId: integer('question_id').references(() => questions.id),
    text: text('text').notNull(),
    isCorrect: integer('is_correct', { mode: 'boolean' }).default(false),
});

// Konfigurasi Aplikasi
export const configs = sqliteTable('configs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(),
    value: text('value'),
});

// Ujian (Tes)
export const tests = sqliteTable('tests', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    detail: text('detail'),
    scoreRight: real('score_right').default(1),
    scoreWrong: real('score_wrong').default(0),
    scoreUnanswered: real('score_unanswered').default(0),
    maxScore: real('max_score').default(0),
    showResult: integer('show_result', { mode: 'boolean' }).default(false),
    showDetail: integer('show_detail', { mode: 'boolean' }).default(false),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
});

// Grup yang bisa mengerjakan Tes
export const testGroups = sqliteTable('test_groups', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testId: integer('test_id').references(() => tests.id).notNull(),
    groupId: integer('group_id').references(() => userGroups.id).notNull(),
});

// Blueprint Topik per Tes (pengacakan)
export const testTopicSets = sqliteTable('test_topic_sets', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testId: integer('test_id').references(() => tests.id).notNull(),
    topicId: integer('topic_id').references(() => topics.id).notNull(),
    questionType: integer('question_type').notNull(), // 1: PG, 2: Essay, 3: Short
    questionCount: integer('question_count').notNull(),
    difficulty: integer('difficulty').default(0), // 0=all
    shuffleQuestions: integer('shuffle_questions', { mode: 'boolean' }).default(true),
    shuffleAnswers: integer('shuffle_answers', { mode: 'boolean' }).default(true),
    answerCount: integer('answer_count').default(5),
    beginTime: integer('begin_time', { mode: 'timestamp' }),
    endTime: integer('end_time', { mode: 'timestamp' }),
    durationMinutes: integer('duration_minutes').notNull().default(60),
});


// Peserta yang mengerjakan Tes
export const testUsers = sqliteTable('test_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testId: integer('test_id').references(() => tests.id),
    userId: integer('user_id').references(() => users.id),
    status: integer('status').default(1), // 1: doing, 4: finished, 10: locked (violation)
    creationTime: integer('creation_time', { mode: 'timestamp' }), // waktu mulai ujian
    usedToken: text('used_token'),
    violationCount: integer('violation_count').default(0),
});

// Soal Acak per Siswa (Cetak Biru Ujian)
export const testQuestions = sqliteTable('test_questions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testUserId: integer('test_user_id').references(() => testUsers.id).notNull(),
    questionId: integer('question_id').references(() => questions.id).notNull(),
    orderIdx: integer('order_idx').notNull(), // tessoal_order
    score: real('score').default(0),
    answerText: text('answer_text'), // for essay
    isAnswered: integer('is_answered', { mode: 'boolean' }).default(false), // true if student submitted any answer
    isDoubtful: integer('is_doubtful', { mode: 'boolean' }).default(false),
    audioPlayCount: integer('audio_play_count').default(0),
});

// Opsi Acak per Soal per Siswa
export const testQuestionAnswers = sqliteTable('test_question_answers', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testQuestionId: integer('test_question_id').references(() => testQuestions.id).notNull(),
    answerId: integer('answer_id').references(() => questionAnswers.id).notNull(),
    orderIdx: integer('order_idx').notNull(), // urutan A, B, C, D
    isSelected: integer('is_selected', { mode: 'boolean' }).default(false),
});

// Token Ujian (PIN)
export const testTokens = sqliteTable('test_tokens', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    testId: integer('test_id').references(() => tests.id).notNull(),
    token: text('token').notNull().unique(),
    lifetimeMinutes: integer('lifetime_minutes').notNull().default(15),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});
