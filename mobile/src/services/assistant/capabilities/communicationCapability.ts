import { Linking } from 'react-native';
import { contactsService } from '../../contacts/contactsService';
import type { AssistantCapability } from '../types';
import { getStringParam } from './common';

const resolveContacts = async (params: Record<string, unknown>) => {
  const contactId = getStringParam(params, 'contactId');
  if (contactId) {
    const contact = await contactsService.getContact(contactId);
    return contact ? [contact] : [];
  }

  const query = getStringParam(params, 'contactQuery') || getStringParam(params, 'query');
  if (!query) {
    return [];
  }

  return contactsService.searchContacts(query);
};

export const communicationCapability: AssistantCapability = {
  namespace: 'communication',

  execute: async (step) => {
    const permission = await contactsService.ensurePermission(true);
    if (!permission.granted) {
      return {
        reply: 'Contacts access is required to resolve communication targets.',
        status: 'blocked_by_permission',
        evidence: { permission },
      };
    }

    const contacts = await resolveContacts(step.params);
    if (contacts.length === 0) {
      return {
        reply: 'No matching contact was found.',
        status: 'failed',
      };
    }
    if (contacts.length > 1) {
      return {
        reply: `I found multiple contacts: ${contacts
          .slice(0, 3)
          .map((contact) => contact.name)
          .join(', ')}.`,
        status: 'needs_confirmation',
        evidence: { contacts },
      };
    }

    const target = contacts[0];
    if (step.command === 'sms.draft') {
      if (!target.primaryPhone) {
        return {
          reply: `${target.name} does not have a phone number.`,
          status: 'failed',
        };
      }
      const body = encodeURIComponent(getStringParam(step.params, 'body') || '');
      const url = `sms:${encodeURIComponent(target.primaryPhone)}?body=${body}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        return {
          reply: 'The Android SMS composer could not be opened.',
          status: 'failed',
        };
      }
      await Linking.openURL(url);
      return {
        reply: `Opened an SMS draft for ${target.name}.`,
        evidence: { contact: target, url },
      };
    }

    if (step.command === 'call.dial') {
      if (!target.primaryPhone) {
        return {
          reply: `${target.name} does not have a phone number.`,
          status: 'failed',
        };
      }
      const url = `tel:${encodeURIComponent(target.primaryPhone)}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        return {
          reply: 'The Android dialer could not be opened.',
          status: 'failed',
        };
      }
      await Linking.openURL(url);
      return {
        reply: `Opened the dialer for ${target.name}.`,
        evidence: { contact: target, url },
      };
    }

    return {
      reply: `Communication command ${step.command} is not implemented.`,
      status: 'failed',
    };
  },

  verify: async (_step, execution) => ({
    ...execution,
    status: execution.status || 'verified',
  }),
};
