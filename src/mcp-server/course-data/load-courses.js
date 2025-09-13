import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function loadCourse(filename) {
  const filePath = join(__dirname, filename);
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));

  console.log(`Loading course: ${data.course.title}`);

  // Insert course
  const { data: course, error: courseError } = await supabase
    .from('courses')
    .insert(data.course)
    .select()
    .single();

  if (courseError) {
    console.error('Error inserting course:', courseError);
    return;
  }

  console.log(`✓ Course created: ${course.title}`);

  // Insert modules with lessons and steps
  for (const moduleData of data.modules) {
    const { lessons, ...moduleInfo } = moduleData;

    // Insert module
    const { data: module, error: moduleError } = await supabase
      .from('modules')
      .insert({
        ...moduleInfo,
        course_id: course.id
      })
      .select()
      .single();

    if (moduleError) {
      console.error('Error inserting module:', moduleError);
      continue;
    }

    console.log(`  ✓ Module created: ${module.title}`);

    // Insert lessons
    for (const lessonData of lessons) {
      const { steps, ...lessonInfo } = lessonData;

      // Insert lesson
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .insert({
          ...lessonInfo,
          module_id: module.id
        })
        .select()
        .single();

      if (lessonError) {
        console.error('Error inserting lesson:', lessonError);
        continue;
      }

      console.log(`    ✓ Lesson created: ${lesson.title}`);

      // Insert steps
      for (const step of steps) {
        const { error: stepError } = await supabase
          .from('steps')
          .insert({
            ...step,
            lesson_id: lesson.id
          });

        if (stepError) {
          console.error('Error inserting step:', stepError);
          continue;
        }
      }

      console.log(`      ✓ ${steps.length} steps created`);
    }
  }

  console.log('\n✅ Course loaded successfully!');
}

// Load the sample course
loadCourse('sample-course.json').catch(console.error);