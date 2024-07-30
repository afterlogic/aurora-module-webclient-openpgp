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
use Aurora\Modules\Contacts\Models\ContactCard;
use Aurora\System\Api;
use Aurora\System\Enums\UserRole;
use Aurora\System\Exceptions\ApiException;
use Aurora\System\Notifications;

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
        $this->subscribeEvent('Contacts::GetContactsByUids::after', array($this, 'onAfterGetContactsByUids'));
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
            if (class_exists('\Aurora\Modules\Files\Module')) {
                $oFilesDecorator = \Aurora\Modules\Files\Module::Decorator();
                if ($oFilesDecorator) {
                    $mResult = $oFilesDecorator->GetFileContent($aArgs['UserId'], $oItem->TypeStr, $oItem->Path, $oItem->Name);
                    if (isset($mResult)) {
                        $oItem->Content = $mResult;
                    }
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
                $needsToUpdate = false;
                if (isset($sPublicPgpKey)) {
                    $oContact->setExtendedProp($this->GetName() . '::PgpKey', $sPublicPgpKey);
                    $needsToUpdate = true;
                } elseif ($oContact->getExtendedProp($this->GetName() . '::PgpKey')) {
                    $oContact->unsetExtendedProp($this->GetName() . '::PgpKey');
                    $needsToUpdate = true;
                }
                if (isset($aArgs['Contact']['PgpEncryptMessages']) && is_bool($aArgs['Contact']['PgpEncryptMessages'])) {
                    if ($aArgs['Contact']['Storage'] !== StorageType::Team) {
                        if ($oContact->getExtendedProp($this->GetName() . '::PgpEncryptMessages') !== $aArgs['Contact']['PgpEncryptMessages']) {
                            $oContact->setExtendedProp($this->GetName() . '::PgpEncryptMessages', $aArgs['Contact']['PgpEncryptMessages']);
                            $needsToUpdate = true;
                        }
                    } elseif ($oContact->getExtendedProp($this->GetName() . '::PgpEncryptMessages_' . $aArgs['UserId']) !== $aArgs['Contact']['PgpEncryptMessages']) {
                        $oContact->setExtendedProp($this->GetName() . '::PgpEncryptMessages_' . $aArgs['UserId'], $aArgs['Contact']['PgpEncryptMessages']);
                        $needsToUpdate = true;
                    }
                }
                if (isset($aArgs['Contact']['PgpSignMessages']) && is_bool($aArgs['Contact']['PgpSignMessages'])) {
                    if ($aArgs['Contact']['Storage'] !== StorageType::Team) {
                        if ($oContact->getExtendedProp($this->GetName() . '::PgpSignMessages') !== $aArgs['Contact']['PgpSignMessages']) {
                            $oContact->setExtendedProp($this->GetName() . '::PgpSignMessages', $aArgs['Contact']['PgpSignMessages']);
                            $needsToUpdate = true;
                        }
                    } elseif ($oContact->getExtendedProp($this->GetName() . '::PgpSignMessages_' . $aArgs['UserId']) !== $aArgs['Contact']['PgpSignMessages']) {
                        $oContact->setExtendedProp($this->GetName() . '::PgpSignMessages_' . $aArgs['UserId'], $aArgs['Contact']['PgpSignMessages']);
                        $needsToUpdate = true;
                    }
                }
                if ($needsToUpdate) {
                    \Aurora\Modules\Contacts\Module::Decorator()->UpdateContactObject($oContact);
                }
                if (is_array($mResult) && isset($mResult['ETag'])) {
                    $mResult['ETag'] = $oContact->ETag;
                }
            }
        }
    }

    /**
     * The function copies values of user-related properties to the properties with original names.
     * Then it removes the user-related flags cause they should be exposed to a user.
     */
    public function onAfterGetContacts($aArgs, &$mResult)
    {
        if (isset($aArgs['UserId']) && isset($mResult['List']) && count($mResult['List']) > 0) {
            $aContactUUIDs = array_map(function ($aValue) { return $aValue['UUID']; }, $mResult['List']);
            $aContactCards = ContactCard::whereIn('CardId', $aContactUUIDs)->whereNotNull('Properties->' . $this->GetName() . '::PgpKey')->get();
            $aContactCardsSorted = array();
            $sEncryptPropName = $this->GetName() . '::PgpEncryptMessages';
            $sSignPropName = $this->GetName() . '::PgpSignMessages';

            foreach ($aContactCards as $oContactCard) {
                $aContactCardsSorted[$oContactCard->CardId] = $oContactCard;
            }

            foreach ($mResult['List'] as &$aContact) {
                $aContact['HasPgpPublicKey'] = false;
                $aContact['PgpEncryptMessages'] = false;
                $aContact['PgpSignMessages'] = false;

                if (isset($aContactCardsSorted[$aContact['UUID']])) {
                    $oContactCard = $aContactCardsSorted[$aContact['UUID']];
                    $aContact['HasPgpPublicKey'] = true;

                    if (!empty($aContact['IsTeam'])) {
                        $aContact['PgpEncryptMessages'] = (bool) $oContactCard->getExtendedProp($sEncryptPropName . '_' . $aArgs['UserId'], false);
                        $aContact['PgpSignMessages'] = (bool) $oContactCard->getExtendedProp($sSignPropName . '_' . $aArgs['UserId'], false);
                    } else {
                        $aContact['PgpEncryptMessages'] = (bool) $oContactCard->getExtendedProp($sEncryptPropName, false);
                        $aContact['PgpSignMessages'] = (bool) $oContactCard->getExtendedProp($sSignPropName, false);
                    }
                }

                // remove OpenPGPWebclient properties
                if (isset($aContact['Properties'])) {
                    foreach ($aContact['Properties'] as $sPropName => $sPropValue) {
                        if (strpos($sPropName, $this->GetName() . '::') !== false) {
                            unset($aContact['Properties'][$sPropName]);
                        }
                    }
                }
            }
        }
    }

    /**
     * The function copies values of user-related properties to the properties with original names.
     * Then it removes the user-related flags cause they should be exposed to a user.
     */
    public function onAfterGetContactsByUids($aArgs, &$mResult)
    {
        if (isset($aArgs['UserId']) && isset($mResult)) {
            foreach ($mResult as $oContact) {
                if ($oContact->Storage === StorageType::Team) {
                    // add property if it's missing
                    if (!$oContact->getExtendedProp('OpenPgpWebclient::PgpKey')) {
                        $oContact->setExtendedProp('OpenPgpWebclient::PgpKey', '');
                    }

                    $sEncryptPropName = $this->GetName() . '::PgpEncryptMessages';
                    $sSignPropName = $this->GetName() . '::PgpSignMessages';

                    // copy user-related values to main properties
                    $oContact->setExtendedProp($sEncryptPropName, $oContact->{$sEncryptPropName . '_' . $aArgs['UserId']} || false);
                    $oContact->setExtendedProp($sSignPropName, $oContact->{$sSignPropName . '_' . $aArgs['UserId']} || false);

                    // remove user-related values from properties
                    foreach ($oContact->Properties as $sPropName => $sPropValue) {
                        if (strpos($sPropName, $sEncryptPropName . '_') !== false || strpos($sPropName, $sSignPropName . '_') !== false) {
                            $oContact->unsetExtendedProp($sPropName);
                        }
                    }
                }
            }
        }
    }

    public function onCastExtendedProp($aArgs, &$mValue)
    {
        if ($aArgs['Model'] instanceof ContactCard &&
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::Anonymous);

        $aSettings = [
            'EnableModule' => false,
            'RememberPassphrase' => false
        ];
        $oUser = Api::getAuthenticatedUser();
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $oUser = Api::getAuthenticatedUser();
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $contact = \Aurora\Modules\Contacts\Module::Decorator()->GetContact($UUID, $UserId);
        if ($contact instanceof Contact) {
            $user = Api::getUserById($UserId);

            if (!\Aurora\Modules\Contacts\Module::Decorator()->CheckAccessToAddressBook($user, $contact->AddressBookId, Access::Write)) {
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $bResult = false;
        $aUpdatedContactIds = [];
        if (\MailSo\Base\Validator::SimpleEmailString($Email)) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByEmails(
                $UserId,
                StorageType::Personal,
                [$Email],
                null,
                false
            );
            if (count($aContacts) === 0) {
                $mResult = \Aurora\Modules\Contacts\Module::Decorator()->CreateContact(
                    [
                        'PersonalEmail' => $Email,
                        'FullName' => $UserName,
                        'Storage' =>  StorageType::Personal
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
                    $properties = $oContact->getExtendedProps();
                    $properties[$this->GetName() . '::PgpKey'] = $Key;
                    ContactCard::where('CardId', $oContact->Id)->update(['Properties' => $properties]);
                    $aUpdatedContactIds[] = $oContact->Id;
                }
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $bResult = false;

        if (\MailSo\Base\Validator::SimpleEmailString($Email)) {
            $aContacts = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsByEmails(
                $UserId,
                StorageType::All,
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
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

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

    public function GetPublicKeysFromContacts($UserId)
    {
        Api::checkUserRoleIsAtLeast(\Aurora\System\Enums\UserRole::NormalUser);

        $aResult = [];

        $aContactsInfo = \Aurora\Modules\Contacts\Module::Decorator()->GetContactsInfo(
            StorageType::All,
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

        if (class_exists('\Aurora\Modules\TeamContacts\Module')) {
            $oTeamContactsDecorator = \Aurora\Modules\TeamContacts\Module::Decorator();
            if ($oTeamContactsDecorator && $oContact instanceof Contact) {
                $properties = $oContact->getExtendedProps();

                $addressbook = $oTeamContactsDecorator->GetTeamAddressbook($UserId);
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

    /**
     *
     * @param int $UserId
     * @param string $Content
     * @param string $FileName
     * @return array|bool
     * @throws ApiException
     */
    public function SaveKeyAsTempFile($UserId, $Content, $FileName)
    {
        $mResult = false;
        Api::checkUserRoleIsAtLeast(UserRole::NormalUser);

        $ext = '';
        $fileInfo = pathinfo($FileName);
        if (isset($fileInfo['extension'])) {
            $ext = strtolower($fileInfo['extension']);
        }

        if ($ext !== 'asc') {
            throw new ApiException(Notifications::FilesNotAllowed);
        }

        $sUUID = Api::getUserUUIDById($UserId);
        try {
            $sTempName = md5($sUUID . $Content . $FileName);
            $oApiFileCache = new \Aurora\System\Managers\Filecache();

            if (!$oApiFileCache->isFileExists($sUUID, $sTempName)) {
                $oApiFileCache->put($sUUID, $sTempName, $Content);
            }

            if ($oApiFileCache->isFileExists($sUUID, $sTempName)) {
                $mResult = \Aurora\System\Utils::GetClientFileResponse(
                    null,
                    $UserId,
                    $FileName,
                    $sTempName,
                    $oApiFileCache->fileSize($sUUID, $sTempName)
                );
            }
        } catch (\Exception $oException) {
            throw new ApiException(Notifications::FilesNotAllowed, $oException, $oException->getMessage());
        }

        return $mResult;
    }
    /***** public functions might be called with web API *****/
}
