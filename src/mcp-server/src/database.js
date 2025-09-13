import { createClient } from '@supabase/supabase-js';
import './env-loader.js';
import { logger } from './logger.js';

// Default demo user for single-user demo
const DEMO_USER = 'demo@cassette.ai';

export class DatabaseHelper {
  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(url, key);
    this.sessionId = null;
  }

  // Session data methods
  async saveSessionData(key, value) {
    const sessionId = this.sessionId || `session_${Date.now()}`;
    this.sessionId = sessionId;

    const { data, error } = await this.supabase
      .from('user_session_data')
      .upsert({
        user_email: DEMO_USER,
        session_id: sessionId,
        data_key: key,
        data_value: value,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_email,session_id,data_key'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error saving session data:', error);
      return null;
    }

    return data;
  }

  async getSessionData(key) {
    const sessionId = this.sessionId || `session_${Date.now()}`;

    const { data, error } = await this.supabase
      .from('user_session_data')
      .select('data_value')
      .eq('user_email', DEMO_USER)
      .eq('session_id', sessionId)
      .eq('data_key', key)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error fetching session data:', error);
      return null;
    }

    return data?.data_value;
  }

  async getLatestSessionData(keys) {
    const { data, error } = await this.supabase
      .from('user_session_data')
      .select('data_key, data_value')
      .eq('user_email', DEMO_USER)
      .in('data_key', keys)
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error('Error fetching session data:', error);
      return {};
    }

    // Convert to key-value object
    const result = {};
    const foundKeys = new Set();

    for (const item of data || []) {
      if (!foundKeys.has(item.data_key)) {
        result[item.data_key] = item.data_value;
        foundKeys.add(item.data_key);
      }
    }

    return result;
  }

  // Course methods
  async getCourse(titleOrId) {
    if (!titleOrId) {
      return null;
    }

    // Try to find by title first
    let { data, error } = await this.supabase
      .from('courses')
      .select('*')
      .eq('title', titleOrId)
      .single();

    // If not found by title, try by ID
    if (!data && titleOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      ({ data, error } = await this.supabase
        .from('courses')
        .select('*')
        .eq('id', titleOrId)
        .single());
    }

    if (error && error.code !== 'PGRST116') {
      logger.error('Error fetching course:', error);
      return null;
    }

    return data;
  }

  async listCourses() {
    const { data, error } = await this.supabase
      .from('courses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error listing courses:', error);
      return [];
    }

    return data || [];
  }

  // Progress methods
  async getUserProgress(courseTitleOrId) {
    // First get the course
    const course = await this.getCourse(courseTitleOrId);
    if (!course) return null;

    const { data, error } = await this.supabase
      .from('user_progress')
      .select('*')
      .eq('user_email', DEMO_USER)
      .eq('course_id', course.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Error fetching progress:', error);
      return null;
    }

    return data;
  }

  async createProgress(courseTitleOrId) {
    const course = await this.getCourse(courseTitleOrId);
    if (!course) return null;

    // Get the first step of the course
    const firstStep = await this.getFirstStep(course.id);
    if (!firstStep) return null;

    const { data, error } = await this.supabase
      .from('user_progress')
      .insert({
        user_email: DEMO_USER,
        course_id: course.id,
        current_step_id: firstStep.id,
        completed_step_ids: []
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating progress:', error);
      return null;
    }

    return data;
  }

  async updateProgress(progressId, updates) {
    const { data, error } = await this.supabase
      .from('user_progress')
      .update(updates)
      .eq('id', progressId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating progress:', error);
      return null;
    }

    return data;
  }

  // Step navigation methods
  async getCurrentStep(progressId) {
    const { data: progress } = await this.supabase
      .from('user_progress')
      .select('current_step_id')
      .eq('id', progressId)
      .single();

    if (!progress?.current_step_id) return null;

    const { data, error } = await this.supabase
      .from('steps')
      .select('*')
      .eq('id', progress.current_step_id)
      .single();

    if (error) {
      logger.error('Error fetching current step:', error);
      return null;
    }

    return data;
  }

  async getNextStep(currentStepId) {
    // Get current step info
    const { data: currentStep } = await this.supabase
      .from('steps')
      .select('lesson_id, order_index')
      .eq('id', currentStepId)
      .single();

    if (!currentStep) return null;

    // Try to get next step in the same lesson
    const { data: nextStep } = await this.supabase
      .from('steps')
      .select('*')
      .eq('lesson_id', currentStep.lesson_id)
      .gt('order_index', currentStep.order_index)
      .order('order_index')
      .limit(1)
      .single();

    if (nextStep) return nextStep;

    // If no more steps in lesson, try next lesson
    const { data: currentLesson } = await this.supabase
      .from('lessons')
      .select('module_id, order_index')
      .eq('id', currentStep.lesson_id)
      .single();

    if (!currentLesson) return null;

    // Try next lesson in same module
    const { data: nextLesson } = await this.supabase
      .from('lessons')
      .select('id')
      .eq('module_id', currentLesson.module_id)
      .gt('order_index', currentLesson.order_index)
      .order('order_index')
      .limit(1)
      .single();

    if (nextLesson) {
      // Get first step of next lesson
      const { data } = await this.supabase
        .from('steps')
        .select('*')
        .eq('lesson_id', nextLesson.id)
        .order('order_index')
        .limit(1)
        .single();

      return data;
    }

    // If no more lessons in module, try next module
    const { data: currentModule } = await this.supabase
      .from('modules')
      .select('course_id, order_index')
      .eq('id', currentLesson.module_id)
      .single();

    if (!currentModule) return null;

    const { data: nextModule } = await this.supabase
      .from('modules')
      .select('id')
      .eq('course_id', currentModule.course_id)
      .gt('order_index', currentModule.order_index)
      .order('order_index')
      .limit(1)
      .single();

    if (!nextModule) return null;

    // Get first lesson of next module
    const { data: firstLesson } = await this.supabase
      .from('lessons')
      .select('id')
      .eq('module_id', nextModule.id)
      .order('order_index')
      .limit(1)
      .single();

    if (!firstLesson) return null;

    // Get first step of that lesson
    const { data } = await this.supabase
      .from('steps')
      .select('*')
      .eq('lesson_id', firstLesson.id)
      .order('order_index')
      .limit(1)
      .single();

    return data;
  }

  async getPreviousStep(currentStepId) {
    // Similar logic but in reverse
    const { data: currentStep } = await this.supabase
      .from('steps')
      .select('lesson_id, order_index')
      .eq('id', currentStepId)
      .single();

    if (!currentStep) return null;

    // Try to get previous step in the same lesson
    const { data: previousStep } = await this.supabase
      .from('steps')
      .select('*')
      .eq('lesson_id', currentStep.lesson_id)
      .lt('order_index', currentStep.order_index)
      .order('order_index', { ascending: false })
      .limit(1)
      .single();

    return previousStep;
  }

  // Helper methods
  async getFirstStep(courseId) {
    // Get first module
    const { data: firstModule } = await this.supabase
      .from('modules')
      .select('id')
      .eq('course_id', courseId)
      .order('order_index')
      .limit(1)
      .single();

    if (!firstModule) return null;

    // Get first lesson
    const { data: firstLesson } = await this.supabase
      .from('lessons')
      .select('id')
      .eq('module_id', firstModule.id)
      .order('order_index')
      .limit(1)
      .single();

    if (!firstLesson) return null;

    // Get first step
    const { data: firstStep } = await this.supabase
      .from('steps')
      .select('*')
      .eq('lesson_id', firstLesson.id)
      .order('order_index')
      .limit(1)
      .single();

    return firstStep;
  }


  async getCourseStats(courseTitleOrId) {
    const progress = await this.getUserProgress(courseTitleOrId);
    if (!progress) return null;

    const course = await this.getCourse(courseTitleOrId);
    if (!course) return null;

    // Get all modules for this course
    const { data: modules } = await this.supabase
      .from('modules')
      .select('id')
      .eq('course_id', course.id);

    if (!modules) return null;

    // Get all lessons for these modules
    const moduleIds = modules.map(m => m.id);
    const { data: lessons } = await this.supabase
      .from('lessons')
      .select('id')
      .in('module_id', moduleIds);

    if (!lessons) return null;

    // Get all steps for these lessons
    const lessonIds = lessons.map(l => l.id);
    const { data: steps } = await this.supabase
      .from('steps')
      .select('id')
      .in('lesson_id', lessonIds);

    const totalSteps = steps?.length || 0;
    const completedSteps = progress.completed_step_ids?.length || 0;
    const percentComplete = totalSteps > 0
      ? Math.round((completedSteps / totalSteps) * 100)
      : 0;

    return {
      totalSteps,
      completedSteps,
      percentComplete
    };
  }
}