<?php
declare(strict_types=1);

namespace Plinth\Api\Storage;

/** Der Speicher kennt den Multipart-Upload nicht (mehr), z. B. abgebrochen oder abgelaufen. */
final class UploadNotFound extends \RuntimeException
{
}
