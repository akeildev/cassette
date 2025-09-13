import { z } from 'zod';
import { DatabaseHelper } from './database.js';
import { formatCourseList, formatStepContent, formatProgress } from './formatters.js';
import dotenv from 'dotenv';

dotenv.config();

const db = new DatabaseHelper();

export const courseTools = [
  {
    name: 'listCourses',
    description: 'List all available courses',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const courses = await db.listCourses();
        return {
          content: formatCourseList(courses)
        };
      } catch (error) {
        return { error: `Failed to list courses: ${error.message}` };
      }
    }
  },
  {
    name: 'startCourse',
    description: 'Start or resume a course',
    inputSchema: z.object({
      email: z.string().email().describe('User email address'),
      courseSlug: z.string().describe('Course slug identifier')
    }),
    handler: async ({ email, courseSlug }) => {
      try {
        // Check if progress exists
        let progress = await db.getUserProgress(email, courseSlug);

        if (!progress) {
          // Create new progress
          progress = await db.createProgress(email, courseSlug);
          if (!progress) {
            return { error: 'Failed to start course' };
          }
        }

        // Get current step
        const currentStep = await db.getCurrentStep(progress.id);
        if (!currentStep) {
          return { error: 'No content available' };
        }

        return {
          content: formatStepContent(currentStep)
        };
      } catch (error) {
        return { error: `Failed to start course: ${error.message}` };
      }
    }
  },
  {
    name: 'nextStep',
    description: 'Move to the next step in the course',
    inputSchema: z.object({
      email: z.string().email().describe('User email address'),
      courseSlug: z.string().describe('Course slug identifier')
    }),
    handler: async ({ email, courseSlug }) => {
      try {
        const progress = await db.getUserProgress(email, courseSlug);
        if (!progress) {
          return { error: 'Course not started. Use startCourse first.' };
        }

        // Get next step
        const nextStep = await db.getNextStep(progress.current_step_id);
        if (!nextStep) {
          return { content: '🎉 Course completed! Well done!' };
        }

        // Update progress
        const completedSteps = [...progress.completed_step_ids];
        if (!completedSteps.includes(progress.current_step_id)) {
          completedSteps.push(progress.current_step_id);
        }

        await db.updateProgress(progress.id, {
          current_step_id: nextStep.id,
          completed_step_ids: completedSteps
        });

        return {
          content: formatStepContent(nextStep)
        };
      } catch (error) {
        return { error: `Failed to move to next step: ${error.message}` };
      }
    }
  },
  {
    name: 'getProgress',
    description: 'Get course progress and statistics',
    inputSchema: z.object({
      email: z.string().email().describe('User email address'),
      courseSlug: z.string().describe('Course slug identifier')
    }),
    handler: async ({ email, courseSlug }) => {
      try {
        const stats = await db.getCourseStats(email, courseSlug);
        if (!stats) {
          return { error: 'No progress found for this course' };
        }

        return {
          content: formatProgress(stats)
        };
      } catch (error) {
        return { error: `Failed to get progress: ${error.message}` };
      }
    }
  }
];