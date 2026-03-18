import * as Contacts from 'expo-contacts';

export type ResolvedContact = {
  id: string;
  name: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
};

const mapContact = (contact: Contacts.ExistingContact): ResolvedContact => ({
  id: contact.id,
  name: contact.name,
  primaryPhone: contact.phoneNumbers?.[0]?.number || null,
  primaryEmail: contact.emails?.[0]?.email || null,
});

export const contactsService = {
  ensurePermission: async (requestIfNeeded = true): Promise<{
    granted: boolean;
    canAskAgain: boolean;
    status: string;
  }> => {
    let permission = await Contacts.getPermissionsAsync();
    if (permission.status !== 'granted' && requestIfNeeded) {
      permission = await Contacts.requestPermissionsAsync();
    }

    return {
      granted: permission.status === 'granted',
      canAskAgain: permission.canAskAgain,
      status: permission.status,
    };
  },

  searchContacts: async (query: string, pageSize = 10): Promise<ResolvedContact[]> => {
    const response = await Contacts.getContactsAsync({
      name: query,
      pageSize,
      sort: Contacts.SortTypes.FirstName,
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    });

    return response.data.map(mapContact);
  },

  getContact: async (contactId: string): Promise<ResolvedContact | null> => {
    const contact = await Contacts.getContactByIdAsync(contactId, [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Emails,
    ]);

    return contact ? mapContact(contact) : null;
  },
};
