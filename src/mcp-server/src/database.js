import { createClient } from '@supabase/supabase-js';
import './env-loader.js';
import { logger } from './logger.js';

export class DatabaseHelper {
  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Missing Supabase credentials');
    }

    this.supabase = createClient(url, key);
  }

  // Course methods
  async getCourse(slug) {
    const { data, error } = await this.supabase
      .from('courses')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
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
  async getUserProgress(email, courseSlug) {
    // First get the course
    const course = await this.getCourse(courseSlug);
    if (!course) return null;

    const { data, error } = await this.supabase
      .from('user_progress')
      .select('*')
      .eq('user_email', email)
      .eq('course_id', course.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Error fetching progress:', error);
      return null;
    }

    return data;
  }

  async createProgress(email, courseSlug) {
    const course = await this.getCourse(courseSlug);
    if (!course) return null;

    // Get the first step of the course
    const firstStep = await this.getFirstStep(course.id);
    if (!firstStep) return null;

    const { data, error } = await this.supabase
      .from('user_progress')
      .insert({
        user_email: email,
        course_id: course.id,
        current_step_id: firstStep.id,
        completed_step_ids: [],
        started_at: new Date().toISOString(),
        last_accessed_at: new Date().toISOString()
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
      .update({
        ...updates,
        last_accessed_at: new Date().toISOString()
      })
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
    let { data: nextStep } = await this.supabase
      .from('steps')
      .select('*')
      .eq('lesson_id', currentStep.lesson_id)
      .gt('order_index', currentStep.order_index)
      .order('order_index')
      .limit(1)
      .single();

    if (nextStep) return nextStep;

    // If no next step in lesson, get first step of next lesson
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
      const { data } = await this.supabase
        .from('steps')
        .select('*')
        .eq('lesson_id', nextLesson.id)
        .order('order_index')
        .limit(1)
        .single();

      if (data) return data;
    }

    // If no next lesson, try next module
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


  async getCourseStats(email, courseSlug) {
    const progress = await this.getUserProgress(email, courseSlug);
    if (!progress) return null;

    const course = await this.getCourse(courseSlug);
    if (!course) return null;

    // Get all modules for this course
    const { data: modules } = await this.supabase
      .from('modules')
      .select('id')
      .eq('course_id', course.id);

    if (!modules || modules.length === 0) {
      return {
        totalSteps: 0,
        completedSteps: 0,
        percentComplete: 0,
        timeSpent: '0m',
        completedLessons: []
      };
    }

    // Get all lessons for these modules
    const moduleIds = modules.map(m => m.id);
    const { data: lessons } = await this.supabase
      .from('lessons')
      .select('id')
      .in('module_id', moduleIds);

    if (!lessons || lessons.length === 0) {
      return {
        totalSteps: 0,
        completedSteps: 0,
        percentComplete: 0,
        timeSpent: '0m',
        completedLessons: []
      };
    }

    // Get total steps count for all lessons
    const lessonIds = lessons.map(l => l.id);
    const { count: totalSteps } = await this.supabase
      .from('steps')
      .select('id', { count: 'exact', head: true })
      .in('lesson_id', lessonIds);

    const completedSteps = progress.completed_step_ids.length;
    const percentComplete = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Calculate time spent
    const timeSpent = this.calculateTimeSpent(progress.started_at, progress.last_accessed_at);

    return {
      totalSteps: totalSteps || 0,
      completedSteps,
      percentComplete,
      currentModule: undefined,
      currentLesson: undefined,
      timeSpent,
      completedLessons: []
    };
  }

  calculateTimeSpent(startDate, lastDate) {
    const diff = new Date(lastDate).getTime() - new Date(startDate).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}