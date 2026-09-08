<?php

namespace Aurora\Modules\OpenPgpWebclient\Tests\Unit;

use Aurora\Modules\Contacts\Enums\StorageType;
use Aurora\Modules\Contacts\Models\ContactCard;
use Aurora\Modules\OpenPgpWebclient\Module;
use Aurora\System\Api;
use Illuminate\Database\Capsule\Manager as Capsule;
use PHPUnit\Framework\TestCase;

class FakeUser
{
	public $Id;
	public $PublicId;
	public $Role;

	public function __construct($id, $publicId, $role = 0)
	{
		$this->Id = $id;
		$this->PublicId = $publicId;
		$this->Role = $role;
	}
}

class FakeContactsDecorator
{
	public $storageType = null;
	public $contacts = [];

	public function GetContactsByEmails($UserId, $Storage, $Emails, $AddressBookId = null)
	{
		$this->storageType = $Storage;
		return $this->contacts;
	}

	public function GetContact($UUID, $UserId)
	{
		foreach ($this->contacts as $oContact) {
			if (isset($oContact->UUID) && $oContact->UUID === $UUID) {
				return $oContact;
			}
		}
		return null;
	}

	public function CheckAccessToAddressBook($oUser, $AddressBookId, $Access)
	{
		return true;
	}
}

class UpdateOwnContactPublicKeyTest extends TestCase
{
	private $testableModule;
	private $fakeContactsDecorator;
	private $capsule;
	private $sPgpKeyProp;

	protected function setUp(): void
	{
		$this->sPgpKeyProp = Module::GetName() . '::PgpKey';

		$this->capsule = new Capsule();
		$this->capsule->addConnection([
			'driver' => 'sqlite',
			'database' => ':memory:',
			'prefix' => '',
		]);
		$this->capsule->setAsGlobal();
		$this->capsule->bootEloquent();

		$this->capsule->schema()->create('contacts_cards', function ($table) {
			$table->increments('Id');
			$table->integer('CardId')->default(0);
			$table->integer('AddressBookId')->default(0);
			$table->string('FullName')->default('');
			$table->integer('PrimaryEmail')->default(0);
			$table->string('ViewEmail')->default('');
			$table->string('FirstName')->default('');
			$table->string('LastName')->default('');
			$table->string('PersonalEmail')->default('');
			$table->string('BusinessEmail')->default('');
			$table->string('OtherEmail')->default('');
			$table->string('BusinessCompany')->default('');
			$table->integer('Frequency')->default(0);
			$table->boolean('IsGroup')->default(false);
			$table->json('Properties')->nullable();
		});

		Api::skipCheckUserRole(true);
		Api::GetModuleManager();

		$this->fakeContactsDecorator = new FakeContactsDecorator();
		Api::$aModuleDecorators['Contacts'] = $this->fakeContactsDecorator;

		$sPath = dirname(__DIR__, 4) . '/';
		$this->testableModule = new Module($sPath);

		$ref = new \ReflectionProperty(Api::class, 'usersCache');
		$ref->setAccessible(true);
		$ref->setValue(null, [
			100 => new FakeUser(100, 'user@example.com', 0),
		]);

		$refSession = new \ReflectionProperty(Api::class, 'aUserSession');
		$refSession->setAccessible(true);
		$refSession->setValue(null, ['UserId' => 100, 'AuthToken' => '']);

		$refAuth = new \ReflectionProperty(Api::class, 'oAuthenticatedUser');
		$refAuth->setAccessible(true);
		$refAuth->setValue(null, null);
	}

	protected function tearDown(): void
	{
		Api::skipCheckUserRole(false);
		Api::$aModuleDecorators['Contacts'] = null;

		$ref = new \ReflectionProperty(Api::class, 'usersCache');
		$ref->setAccessible(true);
		$ref->setValue(null, []);

		$refSession = new \ReflectionProperty(Api::class, 'aUserSession');
		$refSession->setAccessible(true);
		$refSession->setValue(null, []);

		$refAuth = new \ReflectionProperty(Api::class, 'oAuthenticatedUser');
		$refAuth->setAccessible(true);
		$refAuth->setValue(null, null);
	}

	private function createContactCard($cardId, $properties = [])
	{
		$oContact = new ContactCard();
		$oContact->Id = $cardId;
		$oContact->CardId = $cardId;
		$oContact->ViewEmail = 'user@example.com';
		$oContact->Properties = $properties;
		return $oContact;
	}

	private function seedContactCard($cardId, $properties = [])
	{
		Capsule::table('contacts_cards')->insert([
			'CardId' => $cardId,
			'FullName' => 'Test User',
			'PrimaryEmail' => 0,
			'ViewEmail' => 'user@example.com',
			'FirstName' => '',
			'LastName' => '',
			'PersonalEmail' => 'user@example.com',
			'BusinessEmail' => '',
			'OtherEmail' => '',
			'BusinessCompany' => '',
			'Frequency' => 0,
			'IsGroup' => false,
			'Properties' => json_encode($properties),
		]);
	}

	private function callGetOwnContactsByUser($oUser)
	{
		$refMethod = new \ReflectionMethod($this->testableModule, 'getOwnContactsByUser');
		$refMethod->setAccessible(true);
		return $refMethod->invoke($this->testableModule, $oUser);
	}

	public function testGetOwnContactsByUserUsesStorageTypeAll()
	{
		$this->fakeContactsDecorator->contacts = [];

		$this->testableModule->GetOwnContactPublicKey(100);

		$this->assertEquals(StorageType::All, $this->fakeContactsDecorator->storageType);
	}

	public function testUpdateOwnContactPublicKeyRemovesKeyFromPersonalContact()
	{
		$this->seedContactCard(100, [$this->sPgpKeyProp => 'public-key-armor']);

		$oContact = $this->createContactCard(100, [$this->sPgpKeyProp => 'public-key-armor']);
		$this->fakeContactsDecorator->contacts = [$oContact];

		$result = $this->testableModule->UpdateOwnContactPublicKey(100, '');

		$this->assertTrue($result);

		$updated = ContactCard::where('CardId', 100)->first();
		$this->assertNull($updated->getExtendedProp($this->sPgpKeyProp));
	}

	public function testUpdateOwnContactPublicKeySetsNewKey()
	{
		$this->seedContactCard(100, [$this->sPgpKeyProp => 'old-key']);

		$oContact = $this->createContactCard(100, [$this->sPgpKeyProp => 'old-key']);
		$this->fakeContactsDecorator->contacts = [$oContact];

		$result = $this->testableModule->UpdateOwnContactPublicKey(100, 'new-key-armor');

		$this->assertTrue($result);

		$updated = ContactCard::where('CardId', 100)->first();
		$this->assertEquals('new-key-armor', $updated->getExtendedProp($this->sPgpKeyProp));
	}

	public function testUpdateOwnContactPublicKeyReturnsFalseWhenNoContacts()
	{
		$this->fakeContactsDecorator->contacts = [];

		$result = $this->testableModule->UpdateOwnContactPublicKey(100, '');

		$this->assertFalse($result);
	}

	public function testUpdateOwnContactPublicKeyRemovesKeyFromMultipleContacts()
	{
		$this->seedContactCard(100, [$this->sPgpKeyProp => 'team-key']);
		$this->seedContactCard(101, [$this->sPgpKeyProp => 'personal-key']);

		$oTeamContact = $this->createContactCard(100, [$this->sPgpKeyProp => 'team-key']);
		$oPersonalContact = $this->createContactCard(101, [$this->sPgpKeyProp => 'personal-key']);
		$this->fakeContactsDecorator->contacts = [$oTeamContact, $oPersonalContact];

		$result = $this->testableModule->UpdateOwnContactPublicKey(100, '');

		$this->assertTrue($result);

		$teamContact = ContactCard::where('CardId', 100)->first();
		$personalContact = ContactCard::where('CardId', 101)->first();

		$this->assertNull($teamContact->getExtendedProp($this->sPgpKeyProp));
		$this->assertNull($personalContact->getExtendedProp($this->sPgpKeyProp));
	}

	public function testGetOwnContactPublicKeyReturnsKeyFromPersonalContact()
	{
		$oContact = $this->createContactCard(100, [$this->sPgpKeyProp => 'personal-key-armor']);
		$this->fakeContactsDecorator->contacts = [$oContact];

		$result = $this->testableModule->GetOwnContactPublicKey(100);

		$this->assertEquals('personal-key-armor', $result);
	}

	public function testGetOwnContactPublicKeyReturnsKeyFromTeamContact()
	{
		$oContact = $this->createContactCard(100, [$this->sPgpKeyProp => 'team-key-armor']);
		$this->fakeContactsDecorator->contacts = [$oContact];

		$result = $this->testableModule->GetOwnContactPublicKey(100);

		$this->assertEquals('team-key-armor', $result);
	}

	public function testGetOwnContactPublicKeyReturnsKeyFromPersonalContactWhenTeamContactHasNoKey()
	{
		$oTeamContact = $this->createContactCard(100, []);
		$oPersonalContact = $this->createContactCard(101, [$this->sPgpKeyProp => 'personal-key-armor']);
		$this->fakeContactsDecorator->contacts = [$oTeamContact, $oPersonalContact];

		$result = $this->testableModule->GetOwnContactPublicKey(100);

		$this->assertEquals('personal-key-armor', $result);
	}

	public function testGetOwnContactPublicKeyReturnsFalseWhenKeyAbsent()
	{
		$oContact = $this->createContactCard(100, []);
		$this->fakeContactsDecorator->contacts = [$oContact];

		$result = $this->testableModule->GetOwnContactPublicKey(100);

		$this->assertFalse($result);
	}

	public function testGetOwnContactPublicKeyReturnsFalseWhenNoContacts()
	{
		$this->fakeContactsDecorator->contacts = [];

		$result = $this->testableModule->GetOwnContactPublicKey(100);

		$this->assertFalse($result);
	}
}
