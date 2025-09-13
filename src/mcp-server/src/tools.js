import { z } from 'zod';
import { DatabaseHelper } from './database.js';
import { formatCourseList, formatStepContent, formatProgress } from './formatters.js';

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
      courseTitle: z.string().describe('Course title')
    }),
    handler: async ({ courseTitle, platform }) => {
      try {
        // Check if progress exists
        let progress = await db.getUserProgress(courseTitle);

        if (!progress) {
          // Create new progress
          progress = await db.createProgress(courseTitle);
          if (!progress) {
            return { error: 'Failed to start course' };
          }
        }

        // Get current step
        const currentStep = await db.getCurrentStep(progress.id);
        if (!currentStep) {
          return { error: 'No content available' };
        }

        // Get session data for placeholders
        const sessionData = await db.getLatestSessionData(['selected_stock', 'stock_ticker']);

        return {
          content: formatStepContent(currentStep, platform, sessionData)
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
      courseTitle: z.string().describe('Course title')
    }),
    handler: async ({ courseTitle, platform }) => {
      try {
        const progress = await db.getUserProgress(courseTitle);
        if (!progress) {
          return { error: 'Course not started. Use startCourse first.' };
        }

        // Get next step, skipping platform-specific ones that don't match
        let nextStep = await db.getNextStep(progress.current_step_id);

        // Skip steps for other platforms
        while (nextStep && nextStep.platform && nextStep.platform !== platform && nextStep.platform !== 'all') {
          nextStep = await db.getNextStep(nextStep.id);
        }

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

        // Get session data for placeholders
        const sessionData = await db.getLatestSessionData(['selected_stock', 'stock_ticker']);

        return {
          content: formatStepContent(nextStep, platform, sessionData)
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
      courseTitle: z.string().describe('Course title')
    }),
    handler: async ({ courseTitle }) => {
      try {
        const stats = await db.getCourseStats(courseTitle);
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
  },
  {
    name: 'saveSessionData',
    description: 'Save data from the current session (e.g., stock selection)',
    inputSchema: z.object({
      data: z.record(z.any()).describe('Key-value pairs to save')
    }),
    handler: async ({ data }) => {
      try {
        for (const [key, value] of Object.entries(data)) {
          await db.saveSessionData(key, value);
        }
        return { content: 'Session data saved successfully' };
      } catch (error) {
        return { error: `Failed to save session data: ${error.message}` };
      }
    }
  },
  {
    name: 'getSessionData',
    description: 'Retrieve session data for cursor platform',
    inputSchema: z.object({
      keys: z.array(z.string()).describe('Keys to retrieve')
    }),
    handler: async ({ keys }) => {
      try {
        const data = await db.getLatestSessionData(keys);
        return { content: JSON.stringify(data) };
      } catch (error) {
        return { error: `Failed to get session data: ${error.message}` };
      }
    }
  },
  {
    name: 'getCursorStep',
    description: 'Get the cursor-only step for the current course',
    inputSchema: z.object({
      courseTitle: z.string().describe('Course title')
    }),
    handler: async ({ courseTitle }) => {
      try {
        // Get session data
        const sessionData = await db.getLatestSessionData(['selected_stock', 'stock_ticker']);

        // Find the cursor-only step in the course
        const course = await db.getCourse(courseTitle);
        if (!course) return { error: 'Course not found' };

        // Get cursor-only steps
        const { data: steps } = await db.supabase
          .from('steps')
          .select('*')
          .eq('platform', 'cursor-only')
          .order('order_index');

        if (!steps || steps.length === 0) {
          return { error: 'No cursor-specific steps found' };
        }

        // Format the cursor step with session data
        const cursorStep = steps[0];
        let content = formatStepContent(cursorStep, 'cursor', sessionData);

        // Replace placeholders in cursor action content
        if (cursorStep.cursor_action?.parameters?.content_template) {
          let template = cursorStep.cursor_action.parameters.content_template;
          for (const [key, value] of Object.entries(sessionData)) {
            template = template.replace(new RegExp(`{{${key}}}`, 'g'), value);
          }
          cursorStep.cursor_action.parameters.content = template;
          delete cursorStep.cursor_action.parameters.content_template;
        }

        return { content: JSON.stringify(cursorStep.cursor_action) };
      } catch (error) {
        return { error: `Failed to get cursor step: ${error.message}` };
      }
    }
  },
  {
    name: 'resetDemo',
    description: 'Reset the demo by clearing session data (removes saved stock selection)',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        // Clear all session data for the demo user
        const { error: sessionError } = await db.supabase
          .from('user_session_data')
          .delete()
          .eq('user_email', 'demo@cassette.ai');

        // Also clear progress to start fresh
        const { error: progressError } = await db.supabase
          .from('user_progress')
          .delete()
          .eq('user_email', 'demo@cassette.ai');

        if (sessionError || progressError) {
          return { error: `Failed to reset demo: ${(sessionError || progressError).message}` };
        }

        // Reset the session ID in the database helper
        db.sessionId = null;

        return {
          content: '✅ Demo reset successfully! Stock selection cleared. You can now run through the demo again.'
        };
      } catch (error) {
        return { error: `Failed to reset demo: ${error.message}` };
      }
    }
  }
];