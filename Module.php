<?php
/**
 * This code is licensed under AGPLv3 license or Afterlogic Software License
 * if commercial version of the product was purchased.
 * For full statements of the licenses see LICENSE-AFTERLOGIC and LICENSE-AGPL3 files.
 */

namespace Aurora\Modules\OpenPgpWebclient;

use Aurora\Modules\Contacts\Enums\StorageType;
use Aurora\Modules\Contacts\Classes\Contact;
use Aurora\Modules\Contacts\Enums\Access;
use Aurora\Modules\Contacts\Enums\SortField;
use Aurora\Modules\Contacts\Models\ContactCard;
use Aurora\Modules\Contacts\Module as ContactsModule;
use Aurora\Modules\TeamContacts\Module as TeamContactsModule;
use Aurora\System\Api;
use Illuminate\Database\Capsule\Manager as Capsule;

/**
 * @license https://www.gnu.org/licenses/agpl-3.0.html AGPL-3.0
 * @license https://afterlogic.com/products/common-licensing Afterlogic Software License
 * @copyright Copyright (c) 2023, Afterlogic Corp.
 *
 * @property Settings $oModuleSettings
 *
 * @package Modules
 */
class Module extends \Aurora\System\Module\AbstractWebclientModule
{
    /**
     * @return Module
     */
    public static function getInstance()
    {
        return parent::getInstance();
    }

    /**
     * @return Module
     */
    public static function Decorator()
    {
        return parent::Decorator();
    }

    /**
     * @return Settings
     */
    public function getModuleSettings()
    {
        return $this->oModuleSettings;
    }

    public function init()
    {
        $this->subscribeEvent('Files::PopulateFileItem::after', array($this, 'onAfterPopulateFileItem'));
        $this->subscribeEvent('Mail::GetBodyStructureParts', array($this, 'onGetBodyStructureParts'));
        $this->subscribeEvent('Mail::ExtendMessageData', array($this, 'onExtendMessageData'));
        $this->subscribeEvent('Contacts::CreateContact::after', array($this, 'onAfterCreateOrUpdateContact'));
        $this->subscribeEvent('Contacts::UpdateContact::after', array($this, 'onAfterCreateOrUpdateContact'));
        $this->subscribeEvent('Contacts::GetContacts::after', array($this, 'onAfterGetContacts'));
        $this->subscribeEvent('System::CastExtendedProp', array($this, 'onCastExtendedProp'));
    }

    /**
     * @ignore
     * @todo not used
     * @param array $aArgs
     * @param object $oItem
     */
    public function onAfterPopulateFileItem($aArgs, &$oItem)
    {
        if ($oItem && '.asc' === \strtolower(\substr(\trim($oItem->Name), -4))) {
            /** @var \Aurora\Modules\Files\Module $oFilesDecorator */
            $oFilesDecorator = \Aurora\System\Api::GetModuleDecorator('Files');
            if ($oFilesDecorator instanceof \Aurora\System\Module\Decorator) {
                $mResult = $oFilesDecorator->GetFileContent($aArgs['UserId'], $oItem->TypeStr, $oItem->Path, $oItem->Name);
                if (isset($mResult)) {
                    $oItem->Content = $mResult;
                }
            }
        }
    }

    public function onGetBodyStructureParts($aParts, &$aResultParts)
    {
        foreach ($aParts as $oPart) {
            if ($oPart instanceof \MailSo\Imap\BodyStructure && $oPart->ContentType() === 'text/plain' && '.asc' === \strtolower(\substr(\trim($oPart->FileName()), -4))) {
                $aResultParts[] = $oPart;
            }
        }
    }

    public function onExtendMessageData($aData, &$oMessage)
    {
        foreach ($aData as $aDataItem) {
            $oPart = $aDataItem['Part'];
            $bAsc = $oPart instanceof \MailSo\Imap\BodyStructure && $oPart->ContentType() === 'text/plain' && '.asc' === \strtolower(\substr(\trim($oPart->FileName()), -4));
            $sData = $aDataItem['Data'];
            if ($bAsc) {
                $iMimeIndex = $oPart->PartID();
                foreach ($oMessage->getAttachments()->GetAsArray() as $oAttachment) {
                    if ($iMimeIndex === $oAttachment->getMimeIndex()) {
                        $oAttachment->setContent($sData);
                    }
                }
            }
        }
    }

    public function onAfterCreateOrUpdateContact($aArgs, &$mResult)
    {
        if (isset($mResult['UUID']) && isset($aArgs['Contact']['PublicPgpKey'])) {
            $sPublicPgpKey = $aArgs['Contact']['PublicPgpKey'];
            if (empty(\trim($sPublicPgpKey))) {
                $sPublicPgpKey = null;
            }
            $oContact = \Aurora\Modules\Contacts\Module::Decorator()->GetContact($mResult['UUID'], $aArgs['UserId']);
            if ($oContact instanceof Contact) {
                if (isset($sPublicPgpKey)) {
                    $oContact->setExtendedProp($this->GetName() . '::PgpKey', $sPublicPgpKey);
                } else {
                    $oContact->unsetExtendedProp($this->GetName() . '::PgpKey');
                }
                if (isset($aArgs['Contact']['PgpEncryptMessages']) && is_bool($aArgs['Contact']['PgpEncryptMessages'])) {
                    if ($aArgs['Contact']['Storage'] !== StorageType::Team) {
                        $oContact->setExtendedProp($this->GetName() . '::PgpEncryptMessages', $aArgs['Contact']['PgpEncryptMessages']);
                    } else {
                        $oContact->setExtendedProp($this->GetName() . '::PgpEncryptMessages_' . $aArgs['UserId'], $aArgs['Contact']['PgpEncryptMessages']);
                    }
                }
                if (isset($aArgs['Contact']['PgpSignMessages']) && is_bool($aArgs['Contact']['PgpSignMessages'])) {
                    if ($aArgs['Contact']['Storage'] !== StorageType::Team) {
                        $oContact->setExtendedProp($this->GetName() . '::PgpSignMessages', $aArgs['Contact']['PgpSignMessages']);
                    } else {
                        $oContact->setExtendedProp($this->GetName() . '::PgpSignMessages_' . $aArgs['UserId'], $aArgs['Contact']['PgpSignMessages']);
                    }
                }
                \Aurora\Modules\Contacts\Module::Decorator()->UpdateContactObject($oContact);
                if (is_array($mResult) && isset($mResult['ETag'])) {
                    $mResult['ETag'] = $oContact->ETag;
                }
            }
        }
    }

    public function onAfterGetContacts($aArgs, &$mResult)
    {
        if (isset($mResult['List'])) {
            $aContactUUIDs = array_map(function ($aValue) {
                return $aValue['UUID'];
            }, $mResult['List']);
            $aContactsInfo = $this->GetContactsWithPublicKeys($aArgs['UserId'], $aContactUUIDs);
            foreach ($mResult['List'] as &$aContact) {
                $aContact['HasPgpPublicKey'] = false;
                $aContact['PgpEncryptMessages'] = false;
                $aContact['PgpSignMessages'] = false;
                if (isset($aContactsInfo[$aContact['UUID']])) {
                    $aContact['HasPgpPublicKey'] = true;
                    $aContact['PgpEncryptMessages'] = (bool) $aContactsInfo[$aContact['UUID']]['PgpEncryptMessages'];
                    $aContact['PgpSignMessages'] = (bool) $aContactsInfo[$aContact['UUID']]['PgpSignMessages'];
                }
            }
        }
    }

    public function onCastExtendedProp($aArgs, &$mValue)
    {
        if ($aArgs['Model'] instanceof Contact &&
            ($aArgs['PropertyName'] === $this->GetName() . '::PgpEncryptMessages' ||
                $aArgs['PropertyName'] === $this->GetName() . '::PgpSignMessages')) {
            $mValue = (bool) $mValue;
        }
    }

    /***** public functions might be called with web API *****/
    /**
     * Obtains list of module settings for authenticated user.
     *
     * @return array
     */
    public function GetSettings()
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::Anonymous);

        $aSettings = [
            'EnableModule' => false,
            'RememberPassphrase' => false
        ];
        $oUser = \Aurora\System\Api::getAuthenticatedUser();
        if ($oUser && $oUser->isNormalOrTenant()) {
            if (null !== $oUser->getExtendedProp(self::GetName() . '::EnableModule')) {
                $aSettings['EnableModule'] = $oUser->getExtendedProp(self::GetName() . '::EnableModule');
            }
            if (null !== $oUser->getExtendedProp(self::GetName() . '::RememberPassphrase')) {
                $aSettings['RememberPassphrase'] = $oUser->getExtendedProp(self::GetName() . '::RememberPassphrase');
            }
        }
        return $aSettings;
    }

    public function UpdateSettings($EnableModule, $RememberPassphrase)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $oUser = \Aurora\System\Api::getAuthenticatedUser();
        if ($oUser) {
            if ($oUser->isNormalOrTenant()) {
                $oCoreDecorator = \Aurora\Modules\Core\Module::Decorator();
                $oUser->setExtendedProp(self::GetName() . '::EnableModule', $EnableModule);
                if (isset($RememberPassphrase)) {
                    $oUser->setExtendedProp(self::GetName() . '::RememberPassphrase', $RememberPassphrase);
                }
                return $oCoreDecorator->UpdateUserObject($oUser);
            }
            if ($oUser->Role === \Aurora\System\Enums\UserRole::SuperAdmin) {
                return true;
            }
        }

        return false;
    }

    public function AddPublicKeyToContactWithUUID($UserId, $UUID, $Key)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $contact = \Aurora\Modules\Contacts\Module::Decorator()->GetContact($UUID, $UserId);
        if ($contact instanceof Contact) {
            $user = Api::getUserById($UserId);
            
            if (!\Aurora\Modules\Contacts\Module::Decorator()->CheckAccessToAddressBook($user, $contact->Storage, Access::Write)) {
                throw new \Aurora\System\Exceptions\ApiException(\Aurora\System\Notifications::AccessDenied);
            }

            if (\Aurora\Modules\Contacts\Module::Decorator()->UpdateContactObject($contact)) {
                $contact->setExtendedProp($this->GetName() . '::PgpKey', $Key);
                return true;
            }
        }

        return false;
    }

    public function AddPublicKeyToContact($UserId, $Email, $Key, $UserName = '')
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $bResult = false;
        $aUpdatedContactIds = [];
        if (\MailSo\Base\Validator::SimpleEmailString($Email)) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByEmails(
                $UserId,
                \Aurora\Modules\Contacts\Enums\StorageType::Personal,
                [$Email],
                null,
                false
            );
            if (count($aContacts) === 0) {
                $mResult = \Aurora\Modules\Contacts\Module::Decorator()->CreateContact(
                    [
                        'PersonalEmail' => $Email,
                        'FullName' => $UserName,
                        'Storage' =>  \Aurora\Modules\Contacts\Enums\StorageType::Personal
                    ],
                    $UserId
                );
                if (isset($mResult['UUID'])) {
                    $oContact = \Aurora\Modules\Contacts\Module::Decorator()->GetContact($mResult['UUID'], $UserId);
                    if ($oContact instanceof Contact) {
                        $aContacts = [$oContact];
                    }
                }
            }

            if ($aContacts && count($aContacts) > 0) {
                foreach ($aContacts as $oContact) {
                    if ($oContact instanceof ContactCard) {
                        $properties = $oContact->getExtendedProps();
                        $properties[$this->GetName() . '::PgpKey'] = $Key;
                        ContactCard::where('CardId', $oContact->Id)->update(['Properties' => $properties]);
                        $aUpdatedContactIds[] = $oContact->Id;
                    }
                }

                // $bResult = true;
            }
        }

        return $aUpdatedContactIds;
    }

    public function AddPublicKeysToContacts($UserId, $Keys)
    {
        $mResult = false;
        $aUpdatedContactIds = [];

        foreach ($Keys as $aKey) {
            if (isset($aKey['Email'], $aKey['Key'])) {
                $sUserName = isset($aKey['Name']) ? $aKey['Name'] : '';
                $mResult = $this->AddPublicKeyToContact($UserId, $aKey['Email'], $aKey['Key'], $sUserName);
                if (is_array($mResult)) {
                    $aUpdatedContactIds = array_merge($aUpdatedContactIds, $mResult);
                }
            }
        }

        return $aUpdatedContactIds;
    }

    public function RemovePublicKeyFromContact($UserId, $Email)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $bResult = false;

        if (\MailSo\Base\Validator::SimpleEmailString($Email)) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByEmails(
                $UserId,
                \Aurora\Modules\Contacts\Enums\StorageType::All,
                [$Email],
                null,
                false
            );
            if ($aContacts && count($aContacts) > 0) {
                foreach ($aContacts as $oContact) {
                    if ($oContact instanceof ContactCard && !$oContact->IsTeam && !$oContact->Shared) {

                        $properties = $oContact->getExtendedProps();
                        $properties[$this->GetName() . '::PgpKey'] = null;
            
                        ContactCard::where('CardId', $oContact->Id)->update(['Properties' => $properties]);
                    }
                }

                $bResult = true;
            }
        }

        return $bResult;
    }

    public function GetPublicKeysByCountactUUIDs($UserId, $ContactUUIDs)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $aResult = [];

        if (count($ContactUUIDs)) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByUids($UserId, $ContactUUIDs);
            if (is_array($aContacts) && count($aContacts) > 0) {
                foreach ($aContacts as $oContact) {
                    $aResult[] = [
                        'UUID' => $oContact->UUID,
                        'Email' => $oContact->ViewEmail,
                        'PublicPgpKey' => $oContact->getExtendedProp($this->GetName() . '::PgpKey')
                    ];
                }
            }
        }

        return $aResult;
    }

    protected function getContactPgpData($oContact, $iUserId)
    {
        $addressbook = TeamContactsModule::Decorator()->GetTeamAddressbook($iUserId);
        if ($addressbook && $oContact->AddressBookId == $addressbook['id']) {
            return [
                'PgpEncryptMessages' => (bool) $oContact->getExtendedProp($this->GetName() . '::PgpEncryptMessages_' . $iUserId, false),
                'PgpSignMessages' => (bool) $oContact->getExtendedProp($this->GetName() . '::PgpSignMessages_' . $iUserId, false)
            ];
        } else {
            return [
                'PgpEncryptMessages' => (bool) $oContact->getExtendedProp($this->GetName() . '::PgpEncryptMessages', false),
                'PgpSignMessages' => (bool) $oContact->getExtendedProp($this->GetName() . '::PgpSignMessages', false)
            ];
        }
    }

    public function GetContactsWithPublicKeys($UserId, $UUIDs)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);
        $mResult = [];

        $oContactCards = ContactCard::whereIn('CardId', $UUIDs)->whereNotNull('Properties->' . $this->GetName() . '::PgpKey')->get();
        if ($oContactCards) {
            foreach ($oContactCards as $oContactCard) {
                $mResult[$oContactCard->CardId]  = $this->getContactPgpData($oContactCard, $UserId);
            }
        }

        return $mResult;
    }

    public function GetPublicKeysFromContacts($UserId)
    {
        \Aurora\System\Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $aResult = [];

        $aContactsInfo = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsInfo(
            \Aurora\Modules\Contacts\Enums\StorageType::All,
            $UserId,
            ContactCard::whereNotNull('Properties->' . $this->GetName() . '::PgpKey')
        );

        $aContactUUIDs = [];
        if (is_array($aContactsInfo['Info']) && count($aContactsInfo['Info']) > 0) {
            $aContactUUIDs = array_map(function ($aValue) {
                if (!$aValue['IsTeam'] && !$aValue['Shared']) {
                    return $aValue['UUID'];
                }
            }, $aContactsInfo['Info']);
        }
        $aResult = $this->Decorator()->GetPublicKeysByCountactUUIDs($UserId, $aContactUUIDs);

        return $aResult;
    }

    protected function updatePublicKeyFlags($UserId, $oContact, $PgpEncryptMessages = false, $PgpSignMessages = false)
    {
        $mResult = false;

        if ($oContact instanceof Contact) {
            $properties = $oContact->getExtendedProps();

            $addressbook = TeamContactsModule::Decorator()->GetTeamAddressbook($UserId);
            if ($addressbook && $oContact->AddressBookId == $addressbook['id']) {
                $properties[$this->GetName() . '::PgpEncryptMessages_' . $UserId] = $PgpEncryptMessages;
                $properties[$this->GetName() . '::PgpSignMessages_' . $UserId] = $PgpSignMessages;
            } else {
                $properties[$this->GetName() . '::PgpEncryptMessages'] = $PgpEncryptMessages;
                $properties[$this->GetName() . '::PgpSignMessages'] = $PgpSignMessages;
            }

            ContactCard::where('CardId', $oContact->Id)->update(['Properties' => $properties]);

            $mResult = true;
        }
        return $mResult;
    }

    public function UpdateContactPublicKeyFlags($UserId, $UUID, $PgpEncryptMessages = false, $PgpSignMessages = false)
    {
        $oContact = \Aurora\Modules\Contacts\Module::Decorator()->GetContact($UUID, $UserId);
        $mResult = $this->updatePublicKeyFlags($UserId, $oContact, $PgpEncryptMessages, $PgpSignMessages);

        return $mResult;
    }

    protected function getTeamContactByUser($oUser)
    {
        $mResult = false;

        if (Api::GetModuleManager()->IsAllowedModule('TeamContacts')) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByEmails(
                $oUser->Id,
                \Aurora\Modules\Contacts\Enums\StorageType::Team,
                [$oUser->PublicId],
                null,
                false
            );
            if ($aContacts && count($aContacts) > 0) {
                $oContact = $aContacts[0];
                if ($oContact instanceof ContactCard) {
                    $mResult = $oContact;
                }
            }
        }

        return $mResult;
    }

    public function UpdateOwnContactPublicKey($UserId, $PublicPgpKey = '')
    {
        $mResult = false;

        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);
        $oUser = Api::getAuthenticatedUser();
        if ($oUser) {
            if ($oUser->Id === $UserId) {
                $oContactCard = $this->getTeamContactByUser($oUser);
                if ($oContactCard instanceof ContactCard) {
                    $properties = $oContactCard->Properties;
                    if (!empty($PublicPgpKey)) {
                        $properties[$this->GetName() . '::PgpKey'] = $PublicPgpKey;

                    } else {
                        unset($properties[$this->GetName() . '::PgpKey']);
                    }
                    $mResult = !!ContactCard::where('CardId', $oContactCard->Id)->update(['Properties' => $properties]);
                }
            }
        }

        return $mResult;
    }

    public function GetOwnContactPublicKey($UserId)
    {
        $mResult = false;

        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $oUser = Api::getAuthenticatedUser();
        if ($oUser) {
            if ($oUser->Id === $UserId) {
                $oContactCard = $this->getTeamContactByUser($oUser);
                if ($oContactCard instanceof ContactCard) {
                    $mResult = $oContactCard->getExtendedProp($this->GetName() . '::PgpKey', false);
                }
            }
        }

        return $mResult;
    }
    /***** public functions might be called with web API *****/
}