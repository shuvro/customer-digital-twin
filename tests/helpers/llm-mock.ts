import type { ExtractionResult } from '../../src/types/extraction.js';

/**
 * Deterministic LLM mock that returns extraction results based on message content patterns.
 * This simulates what the real LLM would extract without needing an API call.
 */
export function mockExtraction(fullText: string): ExtractionResult {
  const lower = fullText.toLowerCase();

  // Detect which customer the message is about
  if (lower.includes('garcía') || lower.includes('garcia') || lower.includes('maría') || lower.includes('maria') || lower.includes('12345678a')) {
    return mockMariaExtraction(fullText);
  }

  if (lower.includes('weber') || lower.includes('thomas') || lower.includes('65 432 187 909') || lower.includes('65432187909')) {
    return mockThomasExtraction(fullText);
  }

  // Unknown message — return empty
  return { persons: [], confidence: {} };
}

function mockMariaExtraction(fullText: string): ExtractionResult {
  const lower = fullText.toLowerCase();
  const person: Record<string, unknown> = {
    firstName: 'María',
    lastName: 'García López',
    emails: [] as string[],
    phones: [] as string[],
    addresses: [] as Array<Record<string, string>>,
    hobbies: [] as string[],
    needs: [] as string[],
    riskIndicators: [] as string[],
    communicationPreferences: [] as string[],
    familyContext: [] as string[],
    notes: [] as string[],
  };

  // Extract based on content patterns
  if (lower.includes('12345678a')) person.taxId = '12345678A';
  if (lower.includes('14 march 1985') || lower.includes('14/03/1985') || lower.includes('1985-03-14')) person.dateOfBirth = '1985-03-14';
  if (lower.includes('female')) person.gender = 'Female';
  if (lower.includes('spanish')) person.nationality = 'Spanish';

  if (lower.includes('m.garcia85@gmail.com')) (person.emails as string[]).push('m.garcia85@gmail.com');
  if (lower.includes('maria.garcia@email.com')) (person.emails as string[]).push('maria.garcia@email.com');

  if (lower.includes('+34 612 345 678')) (person.phones as string[]).push('+34 612 345 678');
  if (lower.includes('+49 171 2345678')) (person.phones as string[]).push('+49 171 2345678');

  if (lower.includes('madrid')) {
    (person.addresses as Array<Record<string, string>>).push({
      street: 'Calle Gran Vía 28, 3º Izquierda',
      city: 'Madrid',
      postalCode: '28013',
      country: 'Spain',
      fullAddress: 'Calle Gran Vía 28, 3º Izquierda, 28013 Madrid, Spain',
    });
  }

  if (lower.includes('munich') || lower.includes('münchen')) {
    (person.addresses as Array<Record<string, string>>).push({
      street: 'Leopoldstraße 15',
      city: 'Munich',
      postalCode: '80802',
      country: 'Germany',
      fullAddress: 'Leopoldstraße 15, 80802 Munich, Germany',
    });
  }

  if (lower.includes('single')) person.maritalStatus = 'Single';
  if (lower.includes('married')) person.maritalStatus = 'Married';

  if (lower.includes('madridsoft')) {
    person.occupation = 'Software Developer';
    person.employer = 'MadridSoft S.L.';
  }
  if (lower.includes('techcorp')) {
    person.occupation = 'Senior Software Engineer';
    person.employer = 'TechCorp GmbH';
  }

  if (lower.includes('hiking')) (person.hobbies as string[]).push('hiking');
  if (lower.includes('cooking')) (person.hobbies as string[]).push('cooking');

  if (lower.includes('non-smoker') || lower.includes('smoker: no')) (person.riskIndicators as string[]).push('non-smoker');

  if (lower.includes('life insurance')) (person.needs as string[]).push('life insurance');
  if (lower.includes('retirement') || lower.includes('savings')) (person.needs as string[]).push('retirement savings');

  if (lower.includes('prefers email') || lower.includes('email for correspondence')) {
    (person.communicationPreferences as string[]).push('prefers email');
  }

  if (lower.includes('stepchildren') || lower.includes('step')) {
    (person.familyContext as string[]).push('has stepchildren');
  }

  return {
    persons: [person as any],
    confidence: { firstName: 1.0, lastName: 1.0 },
  };
}

function mockThomasExtraction(fullText: string): ExtractionResult {
  const lower = fullText.toLowerCase();
  const person: Record<string, unknown> = {
    firstName: 'Thomas',
    lastName: 'Weber',
    emails: [] as string[],
    phones: [] as string[],
    addresses: [] as Array<Record<string, string>>,
    hobbies: [] as string[],
    needs: [] as string[],
    riskIndicators: [] as string[],
    communicationPreferences: [] as string[],
    familyContext: [] as string[],
    notes: [] as string[],
  };

  if (lower.includes('65 432 187 909') || lower.includes('65432187909')) person.taxId = '65 432 187 909';
  if (lower.includes('22.07.1978') || lower.includes('22 july 1978') || lower.includes('1978-07-22')) person.dateOfBirth = '1978-07-22';
  if (lower.includes('male') && !lower.includes('female')) person.gender = 'Male';
  if (lower.includes('german')) person.nationality = 'German';

  if (lower.includes('t.weber@business.de')) (person.emails as string[]).push('t.weber@business.de');

  if (lower.includes('+49 30 9876543')) (person.phones as string[]).push('+49 30 9876543');
  if (lower.includes('+49 151 7654321')) (person.phones as string[]).push('+49 151 7654321');

  if (lower.includes('berlin')) {
    if (lower.includes('prenzlauer')) {
      (person.addresses as Array<Record<string, string>>).push({
        street: 'Prenzlauer Allee 88',
        city: 'Berlin',
        postalCode: '10405',
        country: 'Germany',
        fullAddress: 'Prenzlauer Allee 88, 10405 Berlin, Germany',
      });
    } else {
      (person.addresses as Array<Record<string, string>>).push({
        street: 'Friedrichstraße 112',
        city: 'Berlin',
        postalCode: '10117',
        country: 'Germany',
        fullAddress: 'Friedrichstraße 112, 10117 Berlin, Germany',
      });
    }
  }

  if (lower.includes('divorced')) person.maritalStatus = 'Divorced';

  if (lower.includes('freelance')) {
    person.occupation = 'Freelance Accountant';
    person.employer = 'Freelance';
  }
  if (lower.includes('finanzberatung')) {
    person.occupation = 'Senior Accountant';
    person.employer = 'FinanzBeratung AG';
  }

  if (lower.includes('cycling')) (person.hobbies as string[]).push('cycling');
  if (lower.includes('photography')) (person.hobbies as string[]).push('photography');

  if (lower.includes('back') && (lower.includes('problem') || lower.includes('issue'))) {
    (person.riskIndicators as string[]).push('back problems');
  }
  if (lower.includes('motorcycle') || lower.includes('bmw')) {
    (person.riskIndicators as string[]).push('motorcycle rider');
  }

  if (lower.includes('health insurance')) (person.needs as string[]).push('health insurance');
  if (lower.includes('riester') || lower.includes('rürup') || lower.includes('investment')) {
    (person.needs as string[]).push('investment/retirement planning');
  }

  if (lower.includes('prefers phone') || lower.includes('phone preferred')) {
    (person.communicationPreferences as string[]).push('prefers phone');
  }
  if (lower.includes('prefers email') || lower.includes('dislikes email')) {
    (person.communicationPreferences as string[]).push('dislikes email');
  }

  if (lower.includes('lukas') || lower.includes('son') || lower.includes('custody')) {
    (person.familyContext as string[]).push('son Lukas, 50% custody');
  }

  return {
    persons: [person as any],
    confidence: { firstName: 1.0, lastName: 1.0 },
  };
}
