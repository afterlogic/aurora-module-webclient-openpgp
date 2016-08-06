<?php

class OpenPgpClientModule extends AApiModule
{
	public function GetAppData()
	{
		return array(
			'EnableModule' => true // AppData.User.EnableOpenPgp
		);
	}
}
